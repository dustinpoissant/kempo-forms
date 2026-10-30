import { eq } from 'drizzle-orm';
import { kempoFormsForm, kempoFormsSubmission, kempoFormsSubmissionEvent } from '../server/db/schema.js';
import { createForm, duplicateForm, setFormStatus, updateForm } from '../server/utils/forms/save.js';
import { getForm, getFormBySlug, listForms } from '../server/utils/forms/read.js';
import { emptyFormTrash, previewEmptyTrash } from '../server/utils/forms/trash.js';
import { ADA, FIELDS, db, handle, heard, listen, makeForm, purge, send, stopListening } from './helpers/forms.js';
import { seedDatabase } from './helpers/db.js';

/*
  Forms: creating, changing, pausing, the Trash, and the hooks around them.
*/

export const beforeAll = async () => {
  await seedDatabase();
  await purge();
  await listen(['kempo-forms:form:before_save', 'kempo-forms:form:saved']);
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
  'a form is created from a title and fields, and gets an address from the title': async ({ pass, fail }) => {
    await reset();
    const [error, form] = await createForm({ input: { title: 'Contact Us!', fields: FIELDS }, createdBy: 'user-1' });
    if(error) return fail(error.msg);
    if(form.slug !== 'contact-us' || form.status !== 'live' || form.createdBy !== 'user-1') return fail(`unexpected form ${JSON.stringify(form)}`);
    if(form.standalonePage !== true || form.submitLabel !== 'Send' || form.useDefaultRecipients !== true) return fail('the defaults');
    pass('');
  },

  'a form refuses a bad address, a reserved one, a used one, and a bad title or redirect': async ({ pass, fail }) => {
    await reset();
    await makeForm({ slug: 'taken' });
    const refuses = async (input, includes, code) => {
      const [error] = await createForm({ input: { title: 'T', fields: FIELDS, ...input } });
      return error && error.msg.includes(includes) && (!code || error.code === code) ? null : `expected "${includes}", got ${JSON.stringify(error)}`;
    };
    const checks = [
      [{ slug: 'Bad Slug' }, 'lowercase letters'],
      [{ slug: 'api' }, 'reserved'],
      [{ slug: 'components' }, 'reserved'],
      [{ slug: 'taken' }, 'already uses', 409],
      [{ title: '' }, 'needs a title'],
      [{ redirectUrl: 'javascript:alert(1)' }, 'redirect'],
      [{ redirectUrl: '//evil.example' }, 'redirect'],
      [{ accountRequirement: 'sometimes' }, 'account requirement'],
      [{ notifyEmails: ['not-an-email'] }, 'not a valid email'],
      [{ notifyEmails: Array.from({ length: 11 }, (_, index) => `a${index}@example.com`) }, 'at most 10'],
      [{ sendConfirmation: true, confirmationField: 'name' }, 'which email field'],
      [{ spamRules: [{ name: 'x', pattern: '(a)\\1' }] }, 'cannot be used'],
    ];
    for(const [input, includes, code] of checks){
      const problem = await refuses(input, includes, code);
      if(problem) return fail(problem);
    }
    pass(`${checks.length} refusals`);
  },

  'recipients are cleaned, lowercased and deduplicated': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['A@Example.com', 'a@example.com', ' b@example.com '] });
    if(form.notifyEmails.join() !== 'a@example.com,b@example.com') return fail(`got ${form.notifyEmails}`);
    pass('');
  },

  'updating a form changes only what was given, and refuses what is wrong': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ title: 'Original', submitLabel: 'Go' });
    const [error, updated] = await updateForm({ id: form.id, changes: { title: 'Changed' } });
    if(error) return fail(error.msg);
    if(updated.title !== 'Changed' || updated.submitLabel !== 'Go' || updated.fields.length !== 3) return fail('everything else stays');
    const [bad] = await updateForm({ id: form.id, changes: { fields: [] } });
    if(!bad) return fail('an empty field list is refused');
    const [missing] = await updateForm({ id: 'nope', changes: {} });
    if(missing?.code !== 404) return fail('an unknown form is 404');
    pass('');
  },

  'two forms cannot share an address, even by changing one': async ({ pass, fail }) => {
    await reset();
    const first = await makeForm({ slug: 'first' });
    await makeForm({ slug: 'second' });
    const [error] = await updateForm({ id: first.id, changes: { slug: 'second' } });
    if(error?.code !== 409) return fail('the unique address holds');
    pass('');
  },

  'the form hooks fire, and a guard can refuse a save': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    if(heard('kempo-forms:form:before_save').length !== 1 || heard('kempo-forms:form:saved').length !== 1) return fail('both fire on create');
    handle('kempo-forms:form:before_save', ({ draft }) => {
      draft.title = `${draft.title} (edited by a hook)`;
    });
    const [, updated] = await updateForm({ id: form.id, changes: { title: 'Plain' } });
    if(updated.title !== 'Plain (edited by a hook)') return fail('a guard can change the draft');
    handle('kempo-forms:form:before_save', () => {
      throw { code: 403, msg: 'Locked by an extension' };
    });
    const [refused] = await updateForm({ id: form.id, changes: { title: 'x' } });
    if(refused?.code !== 403) return fail('a guard can refuse');
    pass('');
  },

  'pausing, then archiving, then restoring brings a form back paused': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    await send(form, ADA);
    const [, paused] = await setFormStatus({ id: form.id, status: 'paused' });
    if(paused.status !== 'paused') return fail('paused');
    const [, archived] = await setFormStatus({ id: form.id, status: 'archived' });
    if(archived.status !== 'archived' || !archived.archivedAt) return fail('archived, with the time');
    const [edit] = await updateForm({ id: form.id, changes: { title: 'x' } });
    if(edit?.code !== 409) return fail('a form in the Trash cannot be edited');

    const events = await db.select().from(kempoFormsSubmissionEvent).where(eq(kempoFormsSubmissionEvent.type, 'form_archived'));
    if(events.length !== 1) return fail('every submission gets a form_archived event');

    const [, restored] = await setFormStatus({ id: form.id, status: 'live' });
    if(restored.status !== 'paused' || restored.archivedAt) return fail('a restored form comes back paused, so it does not take submissions by surprise');
    const [bad] = await setFormStatus({ id: form.id, status: 'deleted' });
    if(!bad) return fail('an unknown status is refused');
    pass('');
  },

  'duplicating makes a paused copy with a free address': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ slug: 'contact', title: 'Contact', notifyEmails: ['a@example.com'] });
    const [, copy] = await duplicateForm({ id: form.id });
    const [, again] = await duplicateForm({ id: form.id });
    if(copy.slug !== 'contact-copy' || again.slug !== 'contact-copy-2') return fail(`got ${copy.slug} and ${again.slug}`);
    if(copy.status !== 'paused' || copy.title !== 'Copy of Contact') return fail('a copy is paused and says so');
    if(copy.notifyEmails.join() !== 'a@example.com' || copy.fields.length !== 3) return fail('the settings and fields are copied');
    pass('');
  },

  'the list counts submissions, hides the Trash and searches the title and address': async ({ pass, fail }) => {
    await reset();
    const alpha = await makeForm({ title: 'Alpha form', slug: 'alpha' });
    const beta = await makeForm({ title: 'Beta', slug: 'beta' });
    const gamma = await makeForm({ title: 'Gamma', slug: 'gamma' });
    await send(alpha, ADA);
    await send(alpha, ADA);
    await setFormStatus({ id: gamma.id, status: 'archived' });

    const [, all] = await listForms();
    if(all.total !== 2 || all.items.some(form => form.status === 'archived')) return fail('the Trash is hidden by default');
    const counted = all.items.find(form => form.slug === 'alpha');
    if(counted.submissionCount !== 2 || counted.newCount !== 2 || !counted.lastSubmissionAt) return fail('counts and the last time are there');
    if(all.items.find(form => form.slug === 'beta').submissionCount !== 0) return fail('a form with none counts zero');

    const [, trash] = await listForms({ status: 'archived' });
    if(trash.items.map(form => form.slug).join() !== 'gamma') return fail('the Trash view lists archived forms');
    const [, found] = await listForms({ search: 'ALP' });
    if(found.items.map(form => form.slug).join() !== 'alpha') return fail('search matches regardless of case');
    const [, escaped] = await listForms({ search: '%' });
    if(escaped.total !== 0) return fail('a percent sign in a search is a literal, not a wildcard');
    if(!beta) return fail('unreachable');
    pass('');
  },

  'reading by id and by address': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ slug: 'here' });
    const [, byId] = await getForm({ id: form.id });
    const [, bySlug] = await getFormBySlug({ slug: 'here' });
    if(byId.slug !== 'here' || bySlug.id !== form.id) return fail('both find it');
    const [missing] = await getFormBySlug({ slug: 'gone' });
    if(missing?.code !== 404) return fail('404 when there is none');
    pass('');
  },

  'emptying the Trash removes the archived forms and their submissions, and nothing else': async ({ pass, fail }) => {
    await reset();
    const keep = await makeForm({ slug: 'keep' });
    const live = await makeForm({ slug: 'drop' });
    await send(keep, ADA);
    await send(live, ADA);
    await send(live, ADA);

    const [, notYet] = await emptyFormTrash();
    if(notYet.forms !== 0) return fail('nothing is removed that has not been archived');

    await setFormStatus({ id: live.id, status: 'archived' });
    const [, preview] = await previewEmptyTrash();
    if(preview.forms !== 1 || preview.submissions !== 2) return fail(`the confirmation says what will go: ${JSON.stringify(preview)}`);

    const [, result] = await emptyFormTrash();
    if(result.forms !== 1 || result.submissions !== 2) return fail(`removed ${JSON.stringify(result)}`);
    if((await db.select().from(kempoFormsForm)).map(form => form.slug).join() !== 'keep') return fail('only the archived form is gone');
    if((await db.select().from(kempoFormsSubmission)).length !== 1) return fail('only its submissions are gone');
    if((await db.select().from(kempoFormsSubmissionEvent).where(eq(kempoFormsSubmissionEvent.type, 'created'))).length !== 1) return fail('their history goes with them');
    pass('');
  },
};
