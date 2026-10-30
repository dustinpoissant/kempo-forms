import { existsSync } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { eq } from 'drizzle-orm';
import { extension } from 'kempo/server/db/schema.js';
import { kempoFormsSubmission } from '../server/db/schema.js';
import { createForm } from '../server/utils/forms/save.js';
import { emptySubmissionTrash, trashSubmissions } from '../server/utils/submissions/manage.js';
import { requestErasure } from '../server/utils/privacy/erase.js';
import downloadGate from '../hooks/fileBeforeDownload.js';
import submitRoute from '../public/api/forms/[slug]/submit/POST.js';
import { db, makeForm, purge, send, withSettings } from './helpers/forms.js';
import { callRoute } from './helpers/http.js';
import { seedDatabase } from './helpers/db.js';

/*
  File uploads through kempo-files. This extension is optional, so this suite runs only where kempo-files is linked in
  (`npm run link:local` does it). Files are written under a folder made for the run, never under this repository.
*/

const installed = existsSync(path.resolve('node_modules/kempo-files/sdk.js'));
const originalCwd = process.cwd();
let site;
let files;
let fileTable;

export const beforeAll = async () => {
  if(!installed) return;
  files = await import('kempo-files/sdk');
  fileTable = (await import(pathToFileURL(path.resolve('node_modules/kempo-files/server/db/schema.js')).href)).kempoFile;
  await seedDatabase();
  await purge();
  site = await mkdtemp(path.join(os.tmpdir(), 'kempo-forms-files-'));
  process.chdir(site);
  await db.delete(extension).where(eq(extension.name, 'kempo-files'));
  await db.insert(extension).values({ name: 'kempo-files', version: '0.0.0', enabled: true, kempo: {}, installedAt: new Date(), updatedAt: new Date() });
};

export const afterAll = async () => {
  if(!installed) return;
  process.chdir(originalCwd);
  await db.delete(extension).where(eq(extension.name, 'kempo-files'));
  await purge();
  await rm(site, { recursive: true, force: true });
};

const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'resume', label: 'Resume', type: 'file', settings: { accept: ['pdf', 'html'] } },
];

const upload = (name, size = 100) => ({ resume: [{ name, data: Buffer.alloc(size, 1), type: 'application/pdf' }] });

const fileRows = () => db.select().from(fileTable);

const only = (name, run) => ({
  [name]: async tools => installed ? run(tools) : tools.pass('runs where kempo-files is linked in (npm run link:local)'),
});

export default {
  ...only('a file field is stored in kempo-files as an inert, private, never-reviewable upload, named for its submission', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: FIELDS });
    const [error, result] = await send(form, { name: 'Ada' }, { files: upload('resume.pdf') });
    if(error) return fail(error.msg);

    const [saved] = await db.select().from(kempoFormsSubmission);
    const ids = saved.values.resume;
    if(!Array.isArray(ids) || ids.length !== 1) return fail(`the submission holds the file id: ${JSON.stringify(saved.values)}`);
    const [, file] = await files.getFile(ids[0]);
    if(file.reviewable !== false || file.trusted !== false || file.public !== false) return fail(`reviewable ${file.reviewable}, trusted ${file.trusted}, public ${file.public}`);
    if(file.name !== `${result.id}-resume.pdf`) return fail(`named ${file.name}`);
    if(file.ownerId !== 'kempo-forms') return fail('an anonymous upload is owned by kempo-forms');
    const [trustError] = await files.setFileTrust({ id: file.id, trusted: true });
    if(trustError?.code !== 409) return fail('kempo-files must refuse to ever trust it');
    pass('');
  }),

  ...only('a signed-in visitor owns their own upload', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: FIELDS });
    await send(form, { name: 'Ada' }, { files: upload('cv.pdf'), meta: { userId: 'user-5' } });
    const [saved] = await db.select().from(kempoFormsSubmission);
    const [, file] = await files.getFile(saved.values.resume[0]);
    if(file.ownerId !== 'user-5') return fail(`owned by ${file.ownerId}`);
    pass('');
  }),

  ...only('an uploaded web page is served as text, never as a page', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: FIELDS });
    await send(form, { name: 'Ada' }, { files: upload('evil.html') });
    const [saved] = await db.select().from(kempoFormsSubmission);
    const [, file] = await files.getFile(saved.values.resume[0]);
    const headers = files.headersFor(file);
    if(!String(headers['Content-Type']).startsWith('text/plain') || headers['X-Content-Type-Options'] !== 'nosniff') return fail(`served as ${JSON.stringify(headers)}`);
    pass('');
  }),

  ...only('a hostile file name cannot leave its folder', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: FIELDS });
    const [error] = await send(form, { name: 'Ada' }, { files: upload('../../../etc/passwd.pdf') });
    if(error) return fail(error.msg);
    const [saved] = await db.select().from(kempoFormsSubmission);
    const [, file] = await files.getFile(saved.values.resume[0]);
    if(file.name.includes('/') || file.name.includes('..')) return fail(`stored as ${file.name}`);
    pass('');
  }),

  ...only('too big, wrong kind, too many and missing are refused per field, and nothing is stored', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: [{ ...FIELDS[0] }, { key: 'resume', label: 'Resume', type: 'file', required: true, settings: { accept: ['pdf'], maxFiles: 1 } }] });
    const before = (await fileRows()).length;

    const [big] = await withSettings([['upload_max_bytes', 50, 'number']], () => send(form, { name: 'A' }, { files: upload('a.pdf', 100) }));
    if(!big?.errors?.resume?.includes('larger')) return fail(`too big: ${JSON.stringify(big)}`);
    const [kind] = await send(form, { name: 'A' }, { files: upload('a.exe') });
    if(!kind?.errors?.resume?.includes('accepted')) return fail(`kind: ${JSON.stringify(kind)}`);
    const [many] = await send(form, { name: 'A' }, { files: { resume: [{ name: 'a.pdf', data: Buffer.alloc(5, 1) }, { name: 'b.pdf', data: Buffer.alloc(5, 1) }] } });
    if(!many?.errors?.resume?.includes('at most 1')) return fail(`many: ${JSON.stringify(many)}`);
    const [missing] = await send(form, { name: 'A' });
    if(!missing?.errors?.resume?.includes('required')) return fail(`missing: ${JSON.stringify(missing)}`);
    const [empty] = await send(form, { name: 'A' }, { files: upload('a.pdf', 0) });
    if(!empty?.errors?.resume) return fail('an empty file is refused');

    if((await fileRows()).length !== before) return fail('refused submissions stored no files');
    pass('');
  }),

  ...only('a file field hidden by a condition is not required and its upload is ignored', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({
      fields: [
        { key: 'cv', label: 'Send a CV', type: 'checkbox' },
        { key: 'resume', label: 'Resume', type: 'file', required: true, showWhen: { key: 'cv', operator: 'checked' } },
      ],
    });
    const before = (await fileRows()).length;
    const [error] = await send(form, { cv: false }, { files: upload('a.pdf') });
    if(error) return fail(error.msg);
    if((await fileRows()).length !== before) return fail('the hidden field\'s upload must be ignored');
    pass('');
  }),

  ...only('a spam submission keeps its files, and a refused one stores nothing', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: FIELDS });
    const before = (await fileRows()).length;
    await send(form, { name: 'Bot' }, { files: upload('a.pdf'), extras: { website_url: 'x' } });
    if((await fileRows()).length !== before + 1) return fail('the spam submission keeps its file for review');
    const refusing = await makeForm({ fields: FIELDS, spamRules: [{ name: 'junk', pattern: 'junk' }] });
    const [error] = await withSettings([['spam_action', 'reject', 'string']], () => send(refusing, { name: 'junk' }, { files: upload('b.pdf') }));
    if(error?.code !== 403) return fail('refused');
    if((await fileRows()).length !== before + 1) return fail('a refused submission stores nothing');
    pass('');
  }),

  ...only('the Trash keeps the file but blocks it, and emptying the Trash deletes it', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: FIELDS });
    await send(form, { name: 'Ada' }, { files: upload('a.pdf') });
    const [saved] = await db.select().from(kempoFormsSubmission);
    const [, file] = await files.getFile(saved.values.resume[0]);

    await trashSubmissions({ ids: [saved.id] });
    if((await files.getFile(file.id))[0]) return fail('still on file while in the Trash');
    let blocked = false;
    try {
      await downloadGate({ file });
    } catch(refusal) {
      blocked = refusal.code === 404;
    }
    if(!blocked) return fail('a trashed submission\'s file cannot be downloaded');

    const [, absolute] = await files.filePath(file);
    await emptySubmissionTrash();
    if((await files.getFile(file.id))[0]?.code !== 404) return fail('the file row is gone');
    if(await stat(absolute).then(() => true, () => false)) return fail('and so are the bytes');
    pass('');
  }),

  ...only('erasing a personal file field deletes the file', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: [{ key: 'email', label: 'Email', type: 'email', required: true }, { key: 'id_card', label: 'ID', type: 'file', personal: true }] });
    await send(form, { email: 'ada@example.com' }, { files: { id_card: [{ name: 'id.pdf', data: Buffer.alloc(10, 1) }] } });
    const [saved] = await db.select().from(kempoFormsSubmission);
    const fileId = saved.values.id_card[0];

    await requestErasure({ email: 'ada@example.com' });
    if((await files.getFile(fileId))[0]?.code !== 404) return fail('the personal file is deleted');
    const [after] = await db.select().from(kempoFormsSubmission);
    if('id_card' in after.values || 'email' in after.values) return fail('and the answers are gone');
    pass('');
  }),

  ...only('the submit route reads a multipart body: the values, the extras and the files', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: FIELDS });
    const boundary = '----kempoformstest';
    const CRLF = '\r\n';
    const part = (name, content, filename) => Buffer.concat([
      Buffer.from([`--${boundary}`, `Content-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}`, ...(filename ? ['Content-Type: application/pdf'] : []), '', ''].join(CRLF)),
      Buffer.isBuffer(content) ? content : Buffer.from(content),
      Buffer.from(CRLF),
    ]);
    const body = Buffer.concat([
      part('values', JSON.stringify({ name: 'Ada' })),
      part('extras', JSON.stringify({})),
      part('resume', Buffer.from([0, 1, 2, 255, 254, 253]), 'cv.pdf'),
      Buffer.from(`--${boundary}--${CRLF}`),
    ]);

    const { status, body: answer } = await callRoute(submitRoute, { params: { slug: form.slug }, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, buffer: body });
    if(status !== 201) return fail(`${status} ${JSON.stringify(answer)}`);
    const [saved] = await db.select().from(kempoFormsSubmission);
    if(saved.values.name !== 'Ada' || saved.values.resume?.length !== 1) return fail(`saved ${JSON.stringify(saved.values)}`);
    const [, file] = await files.getFile(saved.values.resume[0]);
    const [, absolute] = await files.filePath(file);
    const { readFile } = await import('fs/promises');
    if(!(await readFile(absolute)).equals(Buffer.from([0, 1, 2, 255, 254, 253]))) return fail('the file bytes must arrive unchanged');

    const refused = await callRoute(submitRoute, { params: { slug: form.slug }, headers: { 'content-type': 'multipart/form-data' }, buffer: body });
    if(refused.status !== 400) return fail('a multipart body with no boundary is refused');
    pass('');
  }),

  ...only('without kempo-files the file fields are not offered, not required and not stored', async ({ pass, fail }) => {
    await purge();
    const form = await makeForm({ fields: FIELDS });
    await db.delete(extension).where(eq(extension.name, 'kempo-files'));
    try {
      const [error, result] = await send(form, { name: 'Ada' });
      if(error) return fail(`a form with a file field must still work: ${error.msg}`);
      const [refused] = await createForm({ input: { title: 'New', slug: 'new-one', fields: FIELDS } });
      if(!refused?.msg.includes('need kempo-files')) return fail('and new file fields are refused');
      if(!result.id) return fail('submitted');
    } finally {
      await db.insert(extension).values({ name: 'kempo-files', version: '0.0.0', enabled: true, kempo: {}, installedAt: new Date(), updatedAt: new Date() });
    }
    pass('');
  }),
};
