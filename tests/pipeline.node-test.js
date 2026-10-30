import { eq } from 'drizzle-orm';
import { kempoFormsAttempt, kempoFormsSubmission, kempoFormsSubmissionEvent } from '../server/db/schema.js';
import submit from '../server/utils/submissions/submit.js';
import { setFormStatus } from '../server/utils/forms/save.js';
import { ADA, db, handle, heard, listen, makeForm, purge, send, stopListening, withSettings } from './helpers/forms.js';
import { seedDatabase } from './helpers/db.js';

/*
  The submission pipeline, step by step: what is accepted, what is refused, what is kept, and that a visitor can never tell a
  submission that was flagged as spam from one that was not.
*/

const rows = () => db.select().from(kempoFormsSubmission);

export const beforeAll = async () => {
  await seedDatabase();
  await purge();
  await listen(['kempo-forms:submission:filter', 'kempo-forms:submission:before_save', 'kempo-forms:submission:saved']);
};

export const afterAll = async () => {
  await stopListening();
  await purge();
};

const reset = async () => {
  await purge();
  globalThis.kempoFormsCalls = [];
  globalThis.kempoFormsHandlers = {};
};

export default {
  'a good submission is saved with its values, its copy of the form and a history': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ successMessage: 'Thanks!', redirectUrl: '/thanks' });
    const [error, result] = await send(form, ADA, { meta: { ip: '203.0.113.1', userAgent: 'Test Agent', userId: 'user-1' } });
    if(error) return fail(error.msg);
    if(result.message !== 'Thanks!' || result.redirectUrl !== '/thanks') return fail('the form\'s message and redirect come back');

    const [saved] = await rows();
    if(saved.status !== 'new' || saved.formTitle !== 'Contact' || saved.userId !== 'user-1') return fail(`unexpected row ${JSON.stringify(saved)}`);
    if(saved.values.email !== 'ada@example.com' || saved.values.name !== 'Ada Lovelace') return fail('the values are stored');
    if(saved.schema.map(field => field.key).join() !== 'name,email,message') return fail('the form\'s fields are copied onto the submission');
    if(saved.ip !== null) return fail('the IP address must not be stored unless store_ip is on');
    if(saved.userAgent !== 'Test Agent') return fail('the browser is kept');

    const events = await db.select().from(kempoFormsSubmissionEvent).where(eq(kempoFormsSubmissionEvent.submissionId, saved.id));
    if(events.length !== 1 || events[0].type !== 'created') return fail('a created event is written');
    if(heard('kempo-forms:submission:saved').length !== 1) return fail('submission:saved fires once');
    pass('');
  },

  'the IP address is stored only when store_ip is on': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    await withSettings([['store_ip', true, 'boolean']], () => send(form, ADA, { meta: { ip: '203.0.113.9' } }));
    const [saved] = await rows();
    if(saved.ip !== '203.0.113.9') return fail('with store_ip on, the address is kept');
    pass('');
  },

  'what is wrong comes back per field, and nothing is saved': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const [error] = await send(form, { name: '', email: 'not an email' });
    if(!error || error.code !== 400) return fail('a bad submission is a 400');
    if(!error.errors.name || !error.errors.email) return fail(`both fields are named: ${JSON.stringify(error.errors)}`);
    if((await rows()).length) return fail('nothing is saved');
    pass('');
  },

  'unknown, paused and archived forms refuse, and an unknown form is a 404': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const [missing] = await send({ slug: 'nope' }, ADA);
    if(missing?.code !== 404) return fail('an unknown form is 404');

    await setFormStatus({ id: form.id, status: 'paused' });
    const [paused] = await send(form, ADA);
    if(paused?.code !== 409) return fail('a paused form is 409');

    await setFormStatus({ id: form.id, status: 'archived' });
    const [archived] = await send(form, ADA);
    if(archived?.code !== 404) return fail('a form in the Trash is 404');
    pass('');
  },

  'a form can require an account, by itself or through the site setting': async ({ pass, fail }) => {
    await reset();
    const required = await makeForm({ accountRequirement: 'required' });
    const inherit = await makeForm({ accountRequirement: 'inherit' });
    const optional = await makeForm({ accountRequirement: 'optional' });

    const [refused] = await send(required, ADA);
    if(refused?.code !== 401) return fail('an account-only form refuses a signed-out visitor');
    const [allowed] = await send(required, ADA, { meta: { userId: 'u1' } });
    if(allowed) return fail('a signed-in visitor is allowed');
    const [open] = await send(inherit, ADA);
    if(open) return fail('inherit follows the site, which does not require an account by default');

    await withSettings([['require_account', true, 'boolean']], async () => {
      const [siteRefused] = await send(inherit, ADA);
      if(siteRefused?.code !== 401) return fail('with the site setting on, an inherit form needs an account');
      const [exempt] = await send(optional, ADA);
      if(exempt) return fail('a form that says optional ignores the site setting');
    });
    pass('');
  },

  'the honeypot saves the submission as spam and the visitor is told it worked': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ successMessage: 'Sent' });
    const [error, result] = await send(form, ADA, { extras: { website_url: 'http://spam.example' } });
    if(error) return fail('a bot must be told it worked');
    if(result.message !== 'Sent') return fail('the same message as a real one');
    const [saved] = await rows();
    if(saved.status !== 'spam' || saved.spam[0].source !== 'honeypot') return fail('it is kept as spam, with the reason');
    pass('');
  },

  'a regex rule flags a submission as spam, from the site list and from the form': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ spamRules: [{ name: 'Crypto', pattern: 'bitcoin', flags: 'i', fields: ['message'] }] });
    await withSettings([['spam_rules', [{ name: 'Casino', pattern: 'casino', flags: 'i', fields: 'all' }], 'json']], async () => {
      await send(form, { ...ADA, message: 'Buy BITCOIN now' });
      await send(form, { ...ADA, name: 'Best Casino', message: 'hi' });
      await send(form, { ...ADA, message: 'A genuine question' });
    });
    const statuses = (await rows()).sort((a, b) => a.createdAt - b.createdAt).map(row => row.status);
    if(statuses.join() !== 'spam,spam,new') return fail(`expected spam,spam,new but got ${statuses}`);
    const [crypto] = (await rows()).filter(row => row.values.message === 'Buy BITCOIN now');
    if(!crypto.spam[0].reason.includes('Crypto') || JSON.stringify(crypto.spam).includes('BITCOIN')) return fail('the verdict names the rule and never holds the text that matched');
    pass('');
  },

  'a rule only looks at the fields it names': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ spamRules: [{ name: 'Link', pattern: 'http', fields: ['message'] }] });
    await send(form, { ...ADA, name: 'http://example.com is my site' });
    const [saved] = await rows();
    if(saved.status !== 'new') return fail('a match in a field the rule does not name must not count');
    pass('');
  },

  'with spam_action reject, a rule refuses the submission and nothing is saved': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ spamRules: [{ name: 'Junk', pattern: 'junk' }] });
    const [error] = await withSettings([['spam_action', 'reject', 'string']], () => send(form, { ...ADA, message: 'junk' }));
    if(error?.code !== 403) return fail('a rejected submission is a 403');
    if((await rows()).length) return fail('nothing is saved');
    pass('');
  },

  'an extension filter can flag, refuse or merely note a submission': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();

    handle('kempo-forms:submission:filter', ({ verdicts }) => verdicts.push({ source: 'ai', action: 'spam', reason: 'Scored 0.97', score: 0.97 }));
    await send(form, ADA);
    handle('kempo-forms:submission:filter', ({ verdicts }) => verdicts.push({ source: 'captcha', action: 'reject', reason: 'No token', message: 'Please complete the check.' }));
    const [refused] = await send(form, ADA);
    handle('kempo-forms:submission:filter', ({ verdicts }) => verdicts.push({ source: 'ai', action: 'accept', reason: 'Scored 0.1', score: 0.1 }));
    await send(form, ADA);
    handle('kempo-forms:submission:filter', ({ verdicts }) => verdicts.push({ source: 'broken', action: 'explode' }));
    await send(form, ADA);

    if(refused?.code !== 403 || refused.msg !== 'Please complete the check.') return fail('a reject carries the extension\'s message');
    const found = await rows();
    if(found.length !== 3) return fail(`expected three saved, got ${found.length}`);
    const byScore = found.map(row => row.spam[0]);
    if(!byScore.some(verdict => verdict.action === 'spam' && verdict.score === 0.97)) return fail('the spam verdict is saved with its score');
    if(found.filter(row => row.status === 'spam').length !== 1) return fail('only the spam verdict flags: an accept does nothing, and an unknown action counts as accept');
    pass('');
  },

  'an extension filter receives the form, values, extras and meta': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    await send(form, ADA, { extras: { 'cf-token': 'abc' }, meta: { ip: '203.0.113.5', userId: 'u9' } });
    const [call] = heard('kempo-forms:submission:filter');
    if(call.data.extras['cf-token'] !== 'abc') return fail('extras reach the hook');
    if(call.data.meta.ip !== '203.0.113.5' || call.data.meta.userId !== 'u9') return fail('meta reaches the hook');
    if(call.data.form.slug !== form.slug || call.data.values.email !== 'ada@example.com') return fail('the form and the values reach the hook');
    pass('');
  },

  'a filter that throws a refusal refuses, and one that fails otherwise also refuses': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    handle('kempo-forms:submission:filter', () => {
      throw { code: 451, msg: 'Blocked' };
    });
    const [refused] = await send(form, ADA);
    if(refused?.code !== 451 || refused.msg !== 'Blocked') return fail('the refusal reaches the visitor exactly');

    handle('kempo-forms:submission:filter', () => {
      throw new Error('boom');
    });
    const [broken] = await send(form, ADA);
    if(broken?.code !== 500) return fail('a handler that breaks refuses rather than letting the submission through');
    if((await rows()).length) return fail('nothing is saved');
    pass('');
  },

  'before_save can change the values and add extension data': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    handle('kempo-forms:submission:before_save', payload => {
      payload.values.name = payload.values.name.toUpperCase();
      payload.data['my-ext'] = { checked: true };
    });
    await send(form, ADA);
    const [saved] = await rows();
    if(saved.values.name !== 'ADA LOVELACE' || saved.data['my-ext']?.checked !== true) return fail('changes made by the hook are saved');

    handle('kempo-forms:submission:before_save', () => {
      throw { code: 422, msg: 'No' };
    });
    const [refused] = await send(form, ADA);
    if(refused?.code !== 422) return fail('before_save can refuse');
    pass('');
  },

  'the visitor gets the same answer whether it was spam or not': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const [, real] = await send(form, ADA);
    const [, spam] = await send(form, ADA, { extras: { website_url: 'x' } });
    if(JSON.stringify(Object.keys(real)) !== JSON.stringify(Object.keys(spam))) return fail('the answers have different shapes');
    if(real.message !== spam.message) return fail('the messages differ');
    pass('');
  },

  'a value sent for a hidden field is dropped before it is saved': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({
      fields: [
        { key: 'how', label: 'How', type: 'radio', required: true, options: ['phone', 'email'] },
        { key: 'phone', label: 'Phone', type: 'tel', required: true, showWhen: { key: 'how', operator: 'equals', value: 'phone' } },
        { key: 'mail', label: 'Email', type: 'email', required: true, showWhen: { key: 'how', operator: 'equals', value: 'email' } },
      ],
    });
    const [error] = await send(form, { how: 'email', mail: 'a@b.co', phone: '+1 555 000 1111' });
    if(error) return fail(error.msg);
    const [saved] = await rows();
    if('phone' in saved.values) return fail('the phone number of a hidden field must not be stored');
    if(saved.values.mail !== 'a@b.co') return fail('the visible answer is stored');
    pass('');
  },

  'rich text fields only exist while the setting allows them': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({
      fields: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'about', label: 'About', type: 'markdown', required: true }, { key: 'bio', label: 'Bio', type: 'richtext' }],
    });
    const [offError] = await withSettings([['rich_text', 'off', 'string']], () => send(form, { name: 'Ada' }));
    if(offError) return fail('with rich text off, a required markdown field is not part of the form');

    const [missing] = await withSettings([['rich_text', 'markdown', 'string']], () => send(form, { name: 'Ada' }));
    if(!missing?.errors?.about) return fail('in markdown mode the markdown field is required');

    await withSettings([['rich_text', 'html', 'string']], () => send(form, { about: '**hi**', bio: '<p>Hello<script>alert(1)</script></p>' }));
    const saved = (await rows()).find(row => row.values.bio);
    if(!saved || /script/i.test(saved.values.bio)) return fail('HTML is cleaned before it is stored');
    pass('');
  },

  'the rate limit counts attempts, accepted or not, and sets Retry-After': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const attempt = () => send(form, ADA, { meta: { ip: '198.51.100.7' } });
    const results = await withSettings([['rate_limit_per_hour', 3, 'number']], async () => {
      const list = [];
      for(let count = 0; count < 5; count++) list.push(await attempt());
      return list;
    });
    const codes = results.map(([error]) => error?.code ?? 200);
    if(codes.join() !== '200,200,200,429,429') return fail(`expected 200,200,200,429,429 but got ${codes}`);
    if(!(results[3][0].retryAfter > 0)) return fail('a Retry-After is given');
    if((await rows()).length !== 3) return fail('only three are saved');
    const [{ ipHash }] = await db.select().from(kempoFormsAttempt).limit(1);
    if(ipHash.includes('198.51.100.7')) return fail('the address must never be stored, only a hash');
    pass('');
  },

  'the rate limit holds for simultaneous attempts': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const results = await withSettings([['rate_limit_per_hour', 4, 'number']], () => Promise.all(
      Array.from({ length: 12 }, () => send(form, ADA, { meta: { ip: '198.51.100.99' } })),
    ));
    const accepted = results.filter(([error]) => !error).length;
    if(accepted > 4) return fail(`${accepted} got through a limit of 4`);
    if((await rows()).length !== accepted) return fail('every accepted attempt is saved exactly once');
    pass(`${accepted} of 12 accepted`);
  },

  'with no address or the limit off, nothing is counted': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    await send(form, ADA);
    await withSettings([['rate_limit_per_hour', 0, 'number']], () => send(form, ADA, { meta: { ip: '198.51.100.1' } }));
    const attempts = await db.select().from(kempoFormsAttempt);
    if(attempts.length) return fail('no attempt rows without an address, or with the limit off');
    pass('');
  },

  'calling the pipeline directly needs no request': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const [error, result] = await submit({ slug: form.slug, values: ADA });
    if(error) return fail(error.msg);
    if(!result.id) return fail('an id comes back');
    pass('');
  },
};
