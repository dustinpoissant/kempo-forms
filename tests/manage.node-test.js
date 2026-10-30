import { eq } from 'drizzle-orm';
import { kempoFormsAttempt, kempoFormsErasure, kempoFormsSubmission, kempoFormsSubmissionEvent } from '../server/db/schema.js';
import { addSubmissionNote, emptySubmissionTrash, purgeSubmissions, restoreSubmissions, setSubmissionData, setSubmissionStatus, trashSubmissions } from '../server/utils/submissions/manage.js';
import { countByStatus, getSubmissionDetail, listSubmissions } from '../server/utils/submissions/read.js';
import exportCsv from '../server/utils/submissions/csv.js';
import { requestErasure, retryErasures, findMatches } from '../server/utils/privacy/erase.js';
import { hashOf } from '../server/utils/spam/rateLimit.js';
import { runSweep } from '../server/utils/sweeps.js';
import downloadGate from '../hooks/fileBeforeDownload.js';
import userDeleted from '../hooks/userDeleted.js';
import { ADA, db, heard, listen, makeForm, purge, send, stopListening, withSettings } from './helpers/forms.js';
import { seedDatabase } from './helpers/db.js';

/*
  Handling submissions once they are in: status, notes, the Trash, removing them for good, exporting them, erasing a person's
  data, and the retention sweep.
*/

export const beforeAll = async () => {
  await seedDatabase();
  await purge();
  await listen(['kempo-forms:submission:erased']);
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

const one = async (form, values = ADA, extra = {}) => {
  const [error, result] = await send(form, values, extra);
  if(error) throw new Error(error.msg);
  return result.id;
};

const row = async id => (await db.select().from(kempoFormsSubmission).where(eq(kempoFormsSubmission.id, id)))[0];
const eventsOf = async id => (await db.select().from(kempoFormsSubmissionEvent).where(eq(kempoFormsSubmissionEvent.submissionId, id))).map(event => event.type);

export default {
  'new becomes read, and every change is in the history': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const id = await one(form);
    await setSubmissionStatus({ id, status: 'read', actor: 'someone' });
    if((await row(id)).status !== 'read') return fail('read');
    const [noChange] = await setSubmissionStatus({ id, status: 'read' });
    if(noChange) return fail('setting the same status is not an error');
    const [bad] = await setSubmissionStatus({ id, status: 'trashed' });
    if(!bad) return fail('trashed is not set this way');
    if((await eventsOf(id)).join() !== 'created,read') return fail(`history ${await eventsOf(id)}`);
    pass('');
  },

  'notes are kept in the history, and extension data is kept under a key of its own': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const id = await one(form);
    const [empty] = await addSubmissionNote({ id, note: '   ' });
    if(!empty) return fail('an empty note is refused');
    await addSubmissionNote({ id, note: 'Called back', actor: 'staff' });
    const detail = (await getSubmissionDetail({ id }))[1];
    const note = detail.events.find(event => event.type === 'note');
    if(note.data.text !== 'Called back' || note.actor !== 'staff') return fail('the note and who wrote it');

    await setSubmissionData({ id, key: 'my-ext:score', value: { value: 0.4 }, actor: 'my-ext' });
    if((await row(id)).data['my-ext:score'].value !== 0.4) return fail('data is stored');
    await setSubmissionData({ id, key: 'my-ext:score', value: null });
    if('my-ext:score' in (await row(id)).data) return fail('null removes the key');
    const [badKey] = await setSubmissionData({ id, key: 'bad key!', value: 1 });
    if(!badKey) return fail('a bad key is refused');
    pass('');
  },

  'the detail has each value with its label, in the form\'s order': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const id = await one(form);
    const [, detail] = await getSubmissionDetail({ id });
    if(detail.rows.map(entry => entry.label).join() !== 'Name,Email,Message') return fail('labels in order');
    if(detail.rows[1].text !== 'ada@example.com') return fail('the value');
    pass('');
  },

  'the Trash keeps a submission whole, and restoring puts the status back': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const first = await one(form);
    const second = await one(form, ADA, { extras: { website_url: 'x' } });
    await setSubmissionStatus({ id: first, status: 'read' });

    const [, trashed] = await trashSubmissions({ ids: [first, second] });
    if(trashed.trashed !== 2) return fail('both are trashed');
    const [again] = await trashSubmissions({ ids: [first] });
    if(again || (await eventsOf(first)).filter(type => type === 'trashed').length !== 1) return fail('trashing twice records once');

    const [blocked] = await setSubmissionStatus({ id: first, status: 'new' });
    if(blocked?.code !== 409) return fail('a trashed submission must be restored before its status changes');
    const [, inbox] = await listSubmissions();
    if(inbox.total !== 0) return fail('the Trash is out of the default list');
    const [, inTrash] = await listSubmissions({ status: 'trashed' });
    if(inTrash.total !== 2) return fail('the Trash tab lists them');

    await restoreSubmissions({ ids: [first, second] });
    if((await row(first)).status !== 'read' || (await row(second)).status !== 'spam') return fail('each comes back with the status it had');
    pass('');
  },

  'purging removes the rows, the history and fires the hook': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const id = await one(form);
    await trashSubmissions({ ids: [id] });
    const [, result] = await emptySubmissionTrash();
    if(result.purged !== 1) return fail('one purged');
    if((await db.select().from(kempoFormsSubmission)).length || (await db.select().from(kempoFormsSubmissionEvent)).length) return fail('everything is gone');
    const [, nothing] = await purgeSubmissions({ ids: ['nope'] });
    if(nothing.purged !== 0) return fail('unknown ids purge nothing');
    pass('');
  },

  'emptying the Trash of one form leaves the others': async ({ pass, fail }) => {
    await reset();
    const a = await makeForm();
    const b = await makeForm();
    const ida = await one(a);
    const idb = await one(b);
    await trashSubmissions({ ids: [ida, idb] });
    await emptySubmissionTrash({ formId: a.id });
    if(await row(ida) || !(await row(idb))) return fail('only a\'s trash is emptied');
    pass('');
  },

  'the list filters by form, status, search and date, and counts each tab': async ({ pass, fail }) => {
    await reset();
    const a = await makeForm({ title: 'Alpha' });
    const b = await makeForm({ title: 'Beta' });
    await one(a, { ...ADA, name: 'Zebra Person' });
    await one(b);
    await one(b, ADA, { extras: { website_url: 'x' } });

    if((await listSubmissions({ formId: a.id }))[1].total !== 1) return fail('by form');
    if((await listSubmissions({ search: 'zebra' }))[1].total !== 1) return fail('search finds a value without regard to case');
    if((await listSubmissions({ search: 'alpha' }))[1].total !== 1) return fail('search finds the form title');
    if((await listSubmissions({ status: 'spam' }))[1].total !== 1) return fail('by status');
    if((await listSubmissions({}))[1].total !== 2) return fail('the default list leaves out spam');
    if((await listSubmissions({ from: '2999-01-01' }))[1].total !== 0) return fail('from a date in the future');
    const today = new Date().toISOString().slice(0, 10);
    if((await listSubmissions({ from: today, to: today }))[1].total !== 2) return fail('today inclusive');
    const counts = await countByStatus();
    if(counts.new !== 2 || counts.spam !== 1) return fail(`counts ${JSON.stringify(counts)}`);
    pass('');
  },

  'moving a submission out of spam sends nothing here, and records why': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const id = await one(form, ADA, { extras: { website_url: 'x' } });
    await setSubmissionStatus({ id, status: 'new', reason: 'A real person' });
    const [, detail] = await getSubmissionDetail({ id });
    const change = detail.events.find(event => event.type === 'status_changed');
    if(change.data.from !== 'spam' || change.data.reason !== 'A real person') return fail('the history says what it was and why it changed');
    pass('');
  },

  'the CSV has a column per field, neutralises formulas and quotes properly': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    await one(form, { name: '=HYPERLINK("x")', email: 'a@b.co', message: 'Line one\nLine, two' });
    const csv = await exportCsv({});
    const [header, ...lines] = csv.trim().split('\r\n');
    if(header !== 'Submitted,Form,Status,Name,Email,Message') return fail(`header ${header}`);
    if(!csv.includes('\'=HYPERLINK(""x"")')) return fail(`a formula must be prefixed with an apostrophe: ${csv}`);
    if(!csv.includes('"Line one\nLine, two"')) return fail('a cell with a comma or a line break is quoted');
    if(lines.length < 1) return fail('rows');
    pass('');
  },

  'erasing by email removes the personal fields, keeps the rest, and the record holds no address': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({
      fields: [
        { key: 'name', label: 'Name', type: 'text', personal: true },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'topic', label: 'Topic', type: 'text' },
        { key: 'agree', label: 'I agree to be contacted', type: 'checkbox' },
      ],
    });
    const mine = await one(form, { name: 'Ada', email: 'Ada@Example.com', topic: 'Pricing', agree: true }, { meta: { ip: '203.0.113.4', userAgent: 'UA', userId: 'user-ada' } });
    const other = await one(form, { name: 'Bob', email: 'bob@example.com', topic: 'Support', agree: true });
    await addSubmissionNote({ id: mine, note: 'Ada phoned' });

    const matches = await findMatches({ email: ' ada@EXAMPLE.com ' });
    if(matches.length !== 1) return fail('the match ignores case and spaces');

    const [error, result] = await requestErasure({ email: 'ada@example.com', source: 'admin' });
    if(error) return fail(error.msg);
    if(result.matched !== 1) return fail('one submission matched');

    const erased = await row(mine);
    if('name' in erased.values || 'email' in erased.values) return fail('personal values are removed');
    if(erased.values.topic !== 'Pricing' || erased.values.agree !== true) return fail('everything else, consent included, stays');
    if(erased.userId !== null || erased.userAgent !== null || erased.erasedAt === null) return fail('the account, browser and time of erasure');
    if(!erased.schema.find(field => field.key === 'email').erased) return fail('the copy of the form says it was erased');
    const events = await db.select().from(kempoFormsSubmissionEvent).where(eq(kempoFormsSubmissionEvent.submissionId, mine));
    const eraseEvent = events.find(event => event.type === 'erased');
    if(eraseEvent.data.keys.join() !== 'email,name' && eraseEvent.data.keys.join() !== 'name,email') return fail(`the event lists the keys: ${JSON.stringify(eraseEvent.data)}`);
    if(JSON.stringify(events).includes('Ada@Example') || JSON.stringify(events).includes('Ada phoned')) return fail('no value and no note text survives in the history');

    if((await row(other)).values.name !== 'Bob') return fail('somebody else is untouched');
    const [record] = await db.select().from(kempoFormsErasure);
    if(record.status !== 'done' || record.matched !== 1 || record.source !== 'admin') return fail('the request is recorded as done');
    if(JSON.stringify(record).toLowerCase().includes('ada')) return fail('the record holds no address');
    if(heard('kempo-forms:submission:erased').length !== 1) return fail('extensions are told so they can delete their own data');
    pass('');
  },

  'erasing by account finds submissions made while signed in, even without an email field': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ fields: [{ key: 'note', label: 'Note', type: 'text', personal: true }] });
    const id = await one(form, { note: 'My note' }, { meta: { userId: 'user-7' } });
    const [, result] = await requestErasure({ userId: 'user-7', source: 'account' });
    if(result.matched !== 1 || 'note' in (await row(id)).values) return fail('found by account');
    pass('');
  },

  'the user:deleted hook erases, and a failed request is retried by the sweep': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const id = await one(form, ADA, { meta: { userId: 'user-gone' } });
    const other = await one(form, { ...ADA, email: 'other@example.com' });

    await userDeleted({ id: 'user-gone', email: 'ada@example.com', name: 'Ada' });
    if((await row(id)).erasedAt === null) return fail('the hook erased it');
    if((await row(other)).erasedAt !== null) return fail('and only theirs');

    const stuck = await one(form, { ...ADA, name: 'Ada Again' });
    await db.insert(kempoFormsErasure).values({ id: 'retry-1', emailHash: await hashOf('ada@example.com'), source: 'account', status: 'failed', matched: 0, error: 'boom', createdAt: new Date() });
    const done = await retryErasures();
    if(done !== 1) return fail('the sweep finishes it');
    if((await row(stuck)).erasedAt === null) return fail('the retry finds the submission again from the hash alone');
    const [record] = await db.select().from(kempoFormsErasure).where(eq(kempoFormsErasure.id, 'retry-1'));
    if(record.status !== 'done' || record.matched !== 1) return fail('and marks the record done');
    pass('');
  },

  'an invalid request is refused and a request with no matches still leaves a record': async ({ pass, fail }) => {
    await reset();
    const [bad] = await requestErasure({ email: 'not-an-email' });
    if(!bad) return fail('a bad address is refused');
    const [none] = await requestErasure({});
    if(!none) return fail('a request needs an address or an account');
    const [error, result] = await requestErasure({ email: 'nobody@example.com' });
    if(error || result.matched !== 0) return fail('no matches is not an error');
    if((await db.select().from(kempoFormsErasure)).length !== 1) return fail('but it is recorded');
    pass('');
  },

  'the sweep removes old submissions by the retention settings, spam on its own clock': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const oldReal = await one(form);
    const oldSpam = await one(form, ADA, { extras: { website_url: 'x' } });
    const fresh = await one(form);
    const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await db.update(kempoFormsSubmission).set({ createdAt: longAgo }).where(eq(kempoFormsSubmission.id, oldReal));
    await db.update(kempoFormsSubmission).set({ createdAt: longAgo }).where(eq(kempoFormsSubmission.id, oldSpam));

    const nothing = await runSweep();
    if(nothing.old !== 0 || nothing.spam !== 1) return fail(`with retention off and spam at 30 days only the spam goes: ${JSON.stringify(nothing)}`);
    if(await row(oldSpam) || !(await row(oldReal))) return fail('the old spam is gone and the old real one stays');

    await withSettings([['retention_days', 30, 'number']], () => runSweep());
    if(await row(oldReal) || !(await row(fresh))) return fail('with retention at 30 days the old one goes and the fresh one stays');
    pass('');
  },

  'the sweep forgets rate-limit attempts older than a day': async ({ pass, fail }) => {
    await reset();
    await db.insert(kempoFormsAttempt).values([
      { id: 'old', ipHash: 'x', at: new Date(Date.now() - 48 * 60 * 60 * 1000) },
      { id: 'new', ipHash: 'x', at: new Date() },
    ]);
    const result = await runSweep();
    const left = await db.select().from(kempoFormsAttempt);
    if(result.attempts !== 1 || left.length !== 1 || left[0].id !== 'new') return fail('only the old attempt goes');
    pass('');
  },

  'the download gate only blocks the files of trashed submissions': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm();
    const live = await one(form);
    const trashed = await one(form);
    await trashSubmissions({ ids: [trashed] });

    const blocks = async name => {
      try {
        await downloadGate({ file: { name } });
        return false;
      } catch(refusal) {
        return refusal.code === 404;
      }
    };
    if(await blocks('logo.png')) return fail('a file that is not ours is untouched');
    if(await blocks(`${live}-resume.pdf`)) return fail('a live submission\'s file can be opened');
    if(!(await blocks(`${trashed}-resume.pdf`))) return fail('a trashed submission\'s file cannot');
    pass('');
  },
};
