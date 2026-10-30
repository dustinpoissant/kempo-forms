import { eq } from 'drizzle-orm';
import { kempoFormsSubmission } from '../server/db/schema.js';
import { setFormStatus } from '../server/utils/forms/save.js';
import getForm from '../public/api/forms/[slug]/GET.js';
import submitRoute from '../public/api/forms/[slug]/submit/POST.js';
import { ADA, db, makeForm, purge, withSettings } from './helpers/forms.js';
import { callRoute } from './helpers/http.js';
import { seedDatabase } from './helpers/db.js';

/*
  What a visitor can see of a form and how a submission arrives over HTTP, through the real route handlers. The network is left
  out; the routes, the pipeline and the database are not.
*/

export const beforeAll = async () => {
  await seedDatabase();
  await purge();
};

export const afterAll = async () => {
  await purge();
};

export default {
  'a visitor learns how to draw the form and nothing about where it goes': async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({
      notifyEmails: ['secret-owner@example.com'],
      spamRules: [{ name: 'Secret rule', pattern: 'sekrit' }],
      fields: [{ key: 'email', label: 'Email', type: 'email', required: true, personal: true, hint: 'We reply here' }],
    });
    const { status, body } = await callRoute(getForm, { params: { slug: form.slug } });
    if(status !== 200) return fail(`status ${status}`);
    const text = JSON.stringify(body);
    for(const leak of ['secret-owner', 'Secret rule', 'sekrit', 'notifyEmails', 'spamRules', 'personal']){
      if(text.includes(leak)) return fail(`the public definition leaks "${leak}"`);
    }
    if(body.form.fields[0].hint !== 'We reply here' || body.form.fields[0].required !== true) return fail('but it does say how to draw the field');
    if(body.form.honeypot !== 'website_url') return fail('and which field is the honeypot');
    pass('');
  },

  'a paused form answers as closed, a form in the Trash and an unknown one as missing': async ({ pass, fail }) => {
    await purge();
    const form = await makeForm();
    await setFormStatus({ id: form.id, status: 'paused' });
    const paused = await callRoute(getForm, { params: { slug: form.slug } });
    if(paused.status !== 200 || paused.body.form.closed !== true) return fail('a paused form is closed');
    await setFormStatus({ id: form.id, status: 'archived' });
    if((await callRoute(getForm, { params: { slug: form.slug } })).status !== 404) return fail('a form in the Trash is 404');
    if((await callRoute(getForm, { params: { slug: 'nope' } })).status !== 404) return fail('an unknown form is 404');
    pass('');
  },

  'a form that needs an account says so to a signed-out visitor': async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ accountRequirement: 'required' });
    const { body } = await callRoute(getForm, { params: { slug: form.slug } });
    if(body.form.needsAccount !== true || body.form.signedIn !== false) return fail(JSON.stringify(body.form));
    const open = await makeForm({ accountRequirement: 'optional' });
    await withSettings([['require_account', true, 'boolean']], async () => {
      const again = await callRoute(getForm, { params: { slug: open.slug } });
      if(again.body.form.needsAccount !== false) return fail('optional ignores the site setting');
    });
    pass('');
  },

  'a JSON submission is saved and answered with 201 and the message': async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ successMessage: 'Got it' });
    const { status, body } = await callRoute(submitRoute, {
      params: { slug: form.slug },
      body: { values: ADA, extras: {} },
      headers: { 'content-type': 'application/json', 'user-agent': 'Route Test' },
    });
    if(status !== 201 || body.message !== 'Got it') return fail(`${status} ${JSON.stringify(body)}`);
    const [saved] = await db.select().from(kempoFormsSubmission).where(eq(kempoFormsSubmission.formId, form.id));
    if(saved.userAgent !== 'Route Test' || saved.values.name !== 'Ada Lovelace') return fail('the submission was saved with what the request carried');
    pass('');
  },

  'what is wrong comes back as a 400 with the error for each field': async ({ pass, fail }) => {
    await purge();
    const form = await makeForm();
    const { status, body } = await callRoute(submitRoute, { params: { slug: form.slug }, body: { values: { name: '', email: 'x' } }, headers: {} });
    if(status !== 400 || !body.errors?.name || !body.errors?.email) return fail(`${status} ${JSON.stringify(body)}`);
    pass('');
  },

  'a body that is not an object is treated as empty rather than breaking': async ({ pass, fail }) => {
    await purge();
    const form = await makeForm();
    for(const body of [null, 'text', [], { values: 'nope', extras: [] }]){
      const { status } = await callRoute(submitRoute, { params: { slug: form.slug }, body, headers: {} });
      if(status !== 400) return fail(`${JSON.stringify(body)} gave ${status}`);
    }
    pass('');
  },

  'the rate limit answers 429 with Retry-After, and the forwarded address is used only when trusted': async ({ pass, fail }) => {
    await purge();
    const form = await makeForm();
    const send = forwarded => callRoute(submitRoute, { params: { slug: form.slug }, body: { values: ADA }, headers: forwarded ? { 'x-forwarded-for': forwarded } : {} });

    const results = await withSettings([['rate_limit_per_hour', 2, 'number']], async () => {
      // Without trust_proxy the header is ignored, so different forwarded addresses are still one visitor (the request has none, so nothing is counted).
      const list = [];
      for(const address of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) list.push(await send(address));
      return list;
    });
    if(results.some(result => result.status !== 201)) return fail('with no socket address and no trust, nothing is counted');

    const trusted = await withSettings([['rate_limit_per_hour', 2, 'number'], ['trust_proxy', true, 'boolean']], async () => {
      const list = [];
      for(let count = 0; count < 4; count++) list.push(await send('203.0.113.77'));
      return list;
    });
    if(trusted.map(result => result.status).join() !== '201,201,429,429') return fail(`got ${trusted.map(result => result.status)}`);
    if(!trusted[2].headers['Retry-After']) return fail('Retry-After is sent');
    pass('');
  },
};
