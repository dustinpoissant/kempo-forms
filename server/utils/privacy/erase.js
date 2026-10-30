import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsErasure, kempoFormsSubmission, kempoFormsSubmissionEvent } from '../../db/schema.js';
import { newId } from '../ids.js';
import { notify } from '../hooks.js';
import { isEmail } from '../emails.js';
import { removeFiles } from '../files/uploads.js';
import { hashOf } from '../spam/rateLimit.js';
import { addEvent } from '../submissions/events.js';

/*
  Erasing someone's personal data from the submissions they sent (a CCPA or TCPA deletion request).

  A field marked `personal` in the form is erased from a submission: its value is removed, its entry in the submission's copy of
  the form is marked `erased`, and any file it held is deleted from kempo-files. The address, browser and account the visitor
  had are cleared. The rest of the submission stays: its time, its form, every answer that is not personal (a consent box's
  answer included, since a claim about consent needs the proof), its status and its history. The history records the keys
  that were erased and never the values.

  A request is found two ways: by the account (the submission was sent while signed in) or by an email address (a personal
  `email` field holds it, compared without regard to case). The record of the request holds a salted hash of the address and
  never the address itself, so the record is not itself personal data.

  Requests are written down before anything is erased and marked done after, so one that fails halfway is retried by the sweep
  (`retryErasures`) rather than lost. That matters because kempo does not retry a hook that failed.
*/

const BATCH = 500;

const personalEmailKeys = schema => schema.filter(field => field.personal && field.type === 'email' && !field.erased).map(field => field.key);

const likeOf = email => `%${String(email).replace(/[\\%_]/g, '\\$&')}%`;

const sameAddress = (value, email) => typeof value === 'string' && value.trim().toLowerCase() === email;

const matchesRequest = (row, { email, userId }) => {
  if(userId && row.userId === userId) return true;
  return Boolean(email) && personalEmailKeys(row.schema).some(key => sameAddress(row.values[key], email));
};

/*
  The submissions a request covers that have not been erased yet.
*/
export const findMatches = async ({ email = '', userId = '' }) => {
  const address = String(email).trim().toLowerCase();
  if(!address && !userId) return [];
  const conditions = [];
  if(userId) conditions.push(eq(kempoFormsSubmission.userId, String(userId)));
  if(address) conditions.push(sql`${kempoFormsSubmission.values}::text ilike ${likeOf(address)}`);
  const rows = await db.select().from(kempoFormsSubmission).where(and(isNull(kempoFormsSubmission.erasedAt), or(...conditions)));
  return rows.filter(row => matchesRequest(row, { email: address, userId: userId ? String(userId) : '' }));
};

export const eraseSubmission = async (row, { actor = '' } = {}) => {
  const personal = row.schema.filter(field => field.personal && !field.erased);
  const keys = personal.map(field => field.key).filter(key => row.values[key] !== undefined);

  const fileIds = personal.filter(field => field.type === 'file' || field.type === 'image').flatMap(field => Array.isArray(row.values[field.key]) ? row.values[field.key].map(String) : []);
  await removeFiles(fileIds);

  const values = { ...row.values };
  for(const key of keys) delete values[key];
  const schema = row.schema.map(field => field.personal ? { ...field, erased: true } : field);

  await db.update(kempoFormsSubmission).set({ values, schema, ip: null, userAgent: null, userId: null, erasedAt: new Date() }).where(eq(kempoFormsSubmission.id, row.id));

  /* A note a person wrote may name the visitor, so the text of notes goes too. Who wrote one and when stays. */
  await db.update(kempoFormsSubmissionEvent).set({ data: {} }).where(and(eq(kempoFormsSubmissionEvent.submissionId, row.id), eq(kempoFormsSubmissionEvent.type, 'note')));

  await addEvent(row.id, 'erased', { actor, data: { keys } });
  await notify('submission:erased', { submissionId: row.id, formSlug: row.formSlug, keys });
  return keys;
};

const finish = async (id, matched, error = null) => {
  await db.update(kempoFormsErasure)
    .set({ status: error ? 'failed' : 'done', matched, error: error ? String(error).slice(0, 500) : null, completedAt: error ? null : new Date() })
    .where(eq(kempoFormsErasure.id, id));
};

/*
  Erases what a request covers and keeps the record of it. Resolves [null, { id, matched }]; a failure part-way leaves the
  record `failed` for the sweep to retry.
*/
export const requestErasure = async ({ email = '', userId = '', source = 'admin', actor = '' }) => {
  const address = String(email).trim().toLowerCase();
  if(address && !isEmail(address)) return [{ code: 400, msg: 'Enter a valid email address.' }, null];
  if(!address && !userId) return [{ code: 400, msg: 'An email address or an account is required.' }, null];

  const id = newId();
  await db.insert(kempoFormsErasure).values({
    id,
    emailHash: address ? await hashOf(address) : '',
    userId: userId ? String(userId) : null,
    source,
    status: 'pending',
    matched: 0,
    createdAt: new Date(),
  });

  try {
    const rows = await findMatches({ email: address, userId });
    for(const row of rows) await eraseSubmission(row, { actor });
    await finish(id, rows.length);
    return [null, { id, matched: rows.length }];
  } catch(error) {
    console.error(`[kempo-forms] An erasure could not be finished and will be retried: ${error.message}`);
    await finish(id, 0, error.message);
    return [{ code: 500, msg: 'The erasure could not be finished. It will be tried again.' }, null];
  }
};

/*
  The retry. A request holds only the hash of the address, so the submissions are found again by comparing each unerased
  submission's personal email values against it.
*/
export const retryErasures = async () => {
  const waiting = await db.select().from(kempoFormsErasure).where(or(eq(kempoFormsErasure.status, 'pending'), eq(kempoFormsErasure.status, 'failed'))).orderBy(asc(kempoFormsErasure.createdAt)).limit(20);
  let done = 0;

  for(const request of waiting){
    try {
      let matched = 0;
      let after = '';
      for(;;){
        const rows = await db.select().from(kempoFormsSubmission)
          .where(and(isNull(kempoFormsSubmission.erasedAt), gt(kempoFormsSubmission.id, after), sql`${kempoFormsSubmission.schema}::text like '%"personal": true%'`))
          .orderBy(asc(kempoFormsSubmission.id)).limit(BATCH);
        if(!rows.length) break;
        for(const row of rows){
          const byAccount = request.userId && row.userId === request.userId;
          let byAddress = false;
          if(request.emailHash){
            for(const key of personalEmailKeys(row.schema)){
              const value = row.values[key];
              if(typeof value === 'string' && await hashOf(value.trim().toLowerCase()) === request.emailHash) byAddress = true;
            }
          }
          if(byAccount || byAddress){
            await eraseSubmission(row);
            matched++;
          }
        }
        after = rows[rows.length - 1].id;
      }
      await finish(request.id, matched);
      done++;
    } catch(error) {
      await finish(request.id, 0, error.message);
    }
  }
  return done;
};
