import { eq, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsForm } from '../../db/schema.js';
import { newId } from '../ids.js';
import { guard, notify } from '../hooks.js';
import filesAvailable from '../files/available.js';
import { validateForm } from './validate.js';
import { getForm } from './read.js';

/*
  Creating and changing forms. Every function returns [error, data], takes an optional `actor` (the extension that is making the
  change through the SDK; '' for a person), and fires the `form:*` hooks.
*/

export const STATUSES = ['live', 'paused', 'archived'];

/*
  A unique violation. drizzle wraps the driver's error, so the Postgres code can be on the error or on its cause.
*/
const taken = error => [error, error?.cause].some(candidate => candidate?.code === '23505' || /duplicate key|unique constraint/i.test(candidate?.message ?? ''));

const freeSlug = async base => {
  let slug = base;
  for(let number = 2; number < 100; number++){
    const [existing] = await db.select({ id: kempoFormsForm.id }).from(kempoFormsForm).where(eq(kempoFormsForm.slug, slug)).limit(1);
    if(!existing) return slug;
    slug = `${base.slice(0, 74)}-${number}`;
  }
  return `${base.slice(0, 60)}-${newId().slice(0, 8)}`;
};

export const createForm = async ({ input, actor = '', createdBy = null }) => {
  const [invalid, clean] = validateForm(input || {}, { filesAvailable: Boolean(await filesAvailable()) });
  if(invalid) return [invalid, null];

  const draft = { ...clean };
  const [refused] = await guard('form:before_save', { form: null, draft, actor });
  if(refused) return [refused, null];

  const now = new Date();
  const row = { id: newId(), ...draft, status: input.status === 'paused' ? 'paused' : 'live', createdBy, createdAt: now, updatedAt: now, archivedAt: null };
  try {
    await db.insert(kempoFormsForm).values(row);
  } catch(error) {
    if(taken(error)) return [{ code: 409, msg: `Another form already uses the address "${row.slug}".` }, null];
    return [{ code: 500, msg: 'The form could not be saved.' }, null];
  }

  await notify('form:saved', { form: row, previous: null, actor });
  return [null, row];
};

/*
  `changes` holds the properties to change; everything else stays as it is. The result is the whole form again.
*/
export const updateForm = async ({ id, changes, actor = '' }) => {
  const [missing, existing] = await getForm({ id });
  if(missing) return [missing, null];
  if(existing.status === 'archived') return [{ code: 409, msg: 'A form in the Trash cannot be edited. Restore it first.' }, null];

  const merged = { ...existing, ...(changes || {}) };
  const [invalid, clean] = validateForm(merged, { filesAvailable: Boolean(await filesAvailable()) });
  if(invalid) return [invalid, null];

  const draft = { ...clean };
  const [refused] = await guard('form:before_save', { form: existing, draft, actor });
  if(refused) return [refused, null];

  try {
    await db.update(kempoFormsForm).set({ ...draft, updatedAt: new Date() }).where(eq(kempoFormsForm.id, existing.id));
  } catch(error) {
    if(taken(error)) return [{ code: 409, msg: `Another form already uses the address "${draft.slug}".` }, null];
    return [{ code: 500, msg: 'The form could not be saved.' }, null];
  }

  const [, form] = await getForm({ id: existing.id });
  await notify('form:saved', { form, previous: existing, actor });
  return [null, form];
};

/*
  Live, paused or archived. Archiving is the Trash: the form stops accepting submissions and every submission it has gets a
  `form_archived` event. Restoring brings it back as paused, so it does not start taking submissions by surprise.
*/
export const setFormStatus = async ({ id, status, actor = '' }) => {
  if(!STATUSES.includes(status)) return [{ code: 400, msg: 'The status must be live, paused or archived.' }, null];
  const [missing, existing] = await getForm({ id });
  if(missing) return [missing, null];
  if(existing.status === status) return [null, existing];

  const archiving = status === 'archived';
  const next = !archiving && existing.status === 'archived' && status === 'live' ? 'paused' : status;
  await db.update(kempoFormsForm).set({ status: next, archivedAt: archiving ? new Date() : null, updatedAt: new Date() }).where(eq(kempoFormsForm.id, existing.id));

  if(archiving){
    await db.execute(sql`INSERT INTO "kempoFormsSubmissionEvent" ("id", "submissionId", "at", "actor", "type", "data")
      SELECT gen_random_uuid()::text, "id", now(), ${actor}, 'form_archived', '{}'::jsonb FROM "kempoFormsSubmission" WHERE "formId" = ${existing.id}`);
  }

  const [, form] = await getForm({ id: existing.id });
  await notify('form:status_changed', { form, from: existing.status, to: next, actor });
  return [null, form];
};

export const duplicateForm = async ({ id, actor = '', createdBy = null }) => {
  const [missing, existing] = await getForm({ id });
  if(missing) return [missing, null];

  const [error, copy] = await createForm({
    input: { ...existing, title: `Copy of ${existing.title}`.slice(0, 200), slug: await freeSlug(`${existing.slug}-copy`.slice(0, 80)), status: 'paused' },
    actor,
    createdBy,
  });
  return error ? [error, null] : [null, copy];
};
