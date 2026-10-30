import { and, eq, inArray, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsForm, kempoFormsSubmission, kempoFormsSubmissionEvent } from '../../db/schema.js';
import { notify } from '../hooks.js';
import { readConfig } from '../config/settings.js';
import { fileIdsOf, removeFiles } from '../files/uploads.js';
import { sendNotifications } from '../notify/deliver.js';
import { addEvent } from './events.js';
import { getSubmission } from './read.js';

/*
  Changing a submission: its status, notes and extension data, the Trash, and removing one for good. Every function returns
  [error, data] and takes an optional `actor` (the extension making the change through the SDK; '' for a person), which is
  written to the submission's history.

  A submission in the Trash is out of the way but whole: it keeps its files and its history, and can be restored. Only emptying
  the Trash (or the retention sweep) removes one, and removing one takes its files with it.
*/

const MAX_NOTE = 5000;
const MAX_DATA = 100000;

/*
  new, read or spam. Moving a submission out of spam sends the notifications it never got, since it is now a real one.
*/
export const setSubmissionStatus = async ({ id, status, actor = '', reason = '' }) => {
  if(!['new', 'read', 'spam'].includes(status)) return [{ code: 400, msg: 'The status must be new, read or spam.' }, null];
  const [missing, existing] = await getSubmission({ id });
  if(missing) return [missing, null];
  if(existing.status === 'trashed') return [{ code: 409, msg: 'A submission in the Trash must be restored first.' }, null];
  if(existing.status === status) return [null, existing];

  const [updated] = await db.update(kempoFormsSubmission).set({ status }).where(eq(kempoFormsSubmission.id, existing.id)).returning();
  await addEvent(existing.id, status === 'read' && existing.status === 'new' ? 'read' : 'status_changed', {
    actor,
    data: { from: existing.status, to: status, ...(reason ? { reason: String(reason).slice(0, 300) } : {}) },
  });
  await notify('submission:status_changed', { submission: updated, from: existing.status, to: status, actor, reason });

  if(existing.status === 'spam'){
    const [form] = await db.select().from(kempoFormsForm).where(eq(kempoFormsForm.id, existing.formId)).limit(1);
    if(form) await sendNotifications({ submission: updated, form, config: await readConfig(), actor });
  }
  return [null, updated];
};

export const addSubmissionNote = async ({ id, note, actor = '' }) => {
  const text = typeof note === 'string' ? note.trim() : '';
  if(!text) return [{ code: 400, msg: 'Write a note first.' }, null];
  if(text.length > MAX_NOTE) return [{ code: 400, msg: `A note can be at most ${MAX_NOTE} characters.` }, null];
  const [missing, existing] = await getSubmission({ id });
  if(missing) return [missing, null];
  await addEvent(existing.id, 'note', { actor, data: { text } });
  return [null, existing];
};

/*
  Data an extension keeps with a submission, under a key of its own (an AI score, a CRM id). Set it to null to remove the key.
  Extensions that keep personal data here remove it themselves on `submission:erased`.
*/
export const setSubmissionData = async ({ id, key, value, actor = '' }) => {
  if(typeof key !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(key)) return [{ code: 400, msg: 'The data key must be 1 to 100 letters, numbers or . _ : -' }, null];
  const [missing, existing] = await getSubmission({ id });
  if(missing) return [missing, null];

  const data = { ...existing.data };
  if(value === null || value === undefined) delete data[key];
  else data[key] = value;
  if(JSON.stringify(data).length > MAX_DATA) return [{ code: 413, msg: 'That is too much data to keep with a submission.' }, null];

  const [updated] = await db.update(kempoFormsSubmission).set({ data }).where(eq(kempoFormsSubmission.id, existing.id)).returning();
  await addEvent(existing.id, 'data_set', { actor, data: { key } });
  return [null, updated];
};

export const trashSubmissions = async ({ ids, actor = '' }) => {
  if(!Array.isArray(ids) || !ids.length) return [{ code: 400, msg: 'Choose at least one submission.' }, null];
  const rows = await db.update(kempoFormsSubmission)
    .set({ statusBeforeTrash: sql`${kempoFormsSubmission.status}`, status: 'trashed', trashedAt: new Date() })
    .where(and(inArray(kempoFormsSubmission.id, ids.map(String)), sql`${kempoFormsSubmission.status} <> 'trashed'`))
    .returning({ id: kempoFormsSubmission.id });
  for(const row of rows) await addEvent(row.id, 'trashed', { actor });
  return [null, { trashed: rows.length }];
};

export const restoreSubmissions = async ({ ids, actor = '' }) => {
  if(!Array.isArray(ids) || !ids.length) return [{ code: 400, msg: 'Choose at least one submission.' }, null];
  const rows = await db.update(kempoFormsSubmission)
    .set({ status: sql`coalesce(${kempoFormsSubmission.statusBeforeTrash}, 'read')`, statusBeforeTrash: null, trashedAt: null })
    .where(and(inArray(kempoFormsSubmission.id, ids.map(String)), eq(kempoFormsSubmission.status, 'trashed')))
    .returning({ id: kempoFormsSubmission.id });
  for(const row of rows) await addEvent(row.id, 'restored', { actor });
  return [null, { restored: rows.length }];
};

/*
  Removes submissions for good: their files, their history, and the rows. Files first, so a failure part-way leaves submissions
  that still point at their files rather than files nobody points at.
*/
export const purgeSubmissions = async ({ ids, actor = '' }) => {
  if(!Array.isArray(ids) || !ids.length) return [null, { purged: 0 }];
  const rows = await db.select().from(kempoFormsSubmission).where(inArray(kempoFormsSubmission.id, ids.map(String)));
  if(!rows.length) return [null, { purged: 0 }];

  await removeFiles(rows.flatMap(row => fileIdsOf(row.schema, row.values)));
  const found = rows.map(row => row.id);
  await db.delete(kempoFormsSubmissionEvent).where(inArray(kempoFormsSubmissionEvent.submissionId, found));
  await db.delete(kempoFormsSubmission).where(inArray(kempoFormsSubmission.id, found));
  for(const row of rows) await notify('submission:deleted', { submissionId: row.id, formSlug: row.formSlug, actor });
  return [null, { purged: rows.length }];
};

/*
  Empties the Trash, or only one form's part of it.
*/
export const emptySubmissionTrash = async ({ formId = null, actor = '' } = {}) => {
  const filter = formId ? and(eq(kempoFormsSubmission.status, 'trashed'), eq(kempoFormsSubmission.formId, String(formId))) : eq(kempoFormsSubmission.status, 'trashed');
  const rows = await db.select({ id: kempoFormsSubmission.id }).from(kempoFormsSubmission).where(filter);
  return purgeSubmissions({ ids: rows.map(row => row.id), actor });
};

export const resendNotification = async ({ id, actor = '' }) => {
  const [missing, submission] = await getSubmission({ id });
  if(missing) return [missing, null];
  if(submission.status === 'trashed' || submission.status === 'spam') return [{ code: 409, msg: 'Only a submission that is not spam or in the Trash can be sent.' }, null];
  const config = await readConfig();
  if(!config.emailNotifications) return [{ code: 409, msg: 'Email notifications are turned off in the settings.' }, null];
  const [form] = await db.select().from(kempoFormsForm).where(eq(kempoFormsForm.id, submission.formId)).limit(1);
  if(!form) return [{ code: 404, msg: 'The form this came from no longer exists.' }, null];
  return sendNotifications({ submission, form, config, actor });
};
