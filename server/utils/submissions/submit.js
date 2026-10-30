import db from 'kempo/server/db/index.js';
import { kempoFormsSubmission } from '../../db/schema.js';
import { newId } from '../ids.js';
import { guard, notify } from '../hooks.js';
import { readConfig } from '../config/settings.js';
import { effectiveFields } from '../fields/types.js';
import { getFormBySlug } from '../forms/read.js';
import filesAvailable from '../files/available.js';
import { removeFiles, storeFiles } from '../files/uploads.js';
import { recordAttempt } from '../spam/rateLimit.js';
import { runRules } from '../spam/rules.js';
import { sendConfirmation, sendNotifications } from '../notify/deliver.js';
import { addEvent } from './events.js';
import normalise from './normalise.js';
import { cleanVerdict, decide } from './verdicts.js';

/*
  The submission pipeline, from what a visitor sent to a saved submission. Every step returns or refuses, and nothing in here
  reads a request: the HTTP layer passes plain data.

    slug      which form
    values    { [field key]: what was entered }
    extras    everything else the browser sent with it (a captcha token, the honeypot), which only the hooks see
    files     { [field key]: [{ name, data, type }] } for file fields
    meta      { ip, userAgent, userId } as the HTTP layer knows them

  The order is: find the form and check who may submit, count the attempt, normalise and validate, the honeypot, the built-in
  regex rules, the `submission:filter` hook (extensions push verdicts), decide, the `submission:before_save` hook, store any
  files, save with its history, the `submission:saved` hook, then the notifications. The visitor is told the same thing whether
  the submission was accepted or flagged as spam.

  Resolves [null, { id, message, redirectUrl }] or [{ code, msg, errors?, retryAfter? }, null]. `wait` makes it resolve after the
  emails have been handed over; a request should not wait, so the HTTP layer leaves it off.
*/

const HONEYPOT = 'website_url';

const snapshotOf = fields => fields.map(({ key, label, type, options, showWhen, personal, settings }) => ({
  key, label, type, options, ...(showWhen ? { showWhen } : {}), personal, settings,
}));

const accountRequired = (form, config) => form.accountRequirement === 'required' || (form.accountRequirement === 'inherit' && config.requireAccount);

export default async ({ slug, values = {}, extras = {}, files = {}, meta = {}, actor = '', wait = false }) => {
  const config = await readConfig();

  const [missing, form] = await getFormBySlug({ slug });
  if(missing || form.status === 'archived') return [{ code: 404, msg: 'This form does not exist.' }, null];
  if(form.status === 'paused') return [{ code: 409, msg: 'This form is not accepting submissions right now.' }, null];
  if(accountRequired(form, config) && !meta.userId) return [{ code: 401, msg: 'Sign in to send this form.' }, null];

  const [limited] = await recordAttempt({ ip: meta.ip, limit: config.rateLimitPerHour });
  if(limited) return [limited, null];

  const available = Boolean(await filesAvailable());
  const fields = effectiveFields(form.fields, { richText: config.richText, filesAvailable: available });
  const fileInfo = Object.fromEntries(Object.entries(files).map(([key, list]) => [key, (Array.isArray(list) ? list : []).map(file => ({ name: String(file.name ?? 'file'), size: Buffer.isBuffer(file.data) ? file.data.length : 0 }))]));

  const result = normalise({ fields, input: values, files: fileInfo, config });
  if(Object.keys(result.errors).length) return [{ code: 400, msg: 'Please check the highlighted fields.', errors: result.errors }, null];

  const verdicts = [];
  if(String(extras[HONEYPOT] ?? values[HONEYPOT] ?? '').trim()){
    verdicts.push({ source: 'honeypot', action: 'spam', reason: 'The hidden field was filled in' });
  }
  verdicts.push(...runRules({
    rules: [...config.spamRules, ...(form.spamRules || [])],
    fields: fields.filter(field => result.visible.has(field.key)),
    values: result.values,
    action: config.spamAction,
  }));

  const filterPayload = { form, values: result.values, extras, meta: { ip: meta.ip ?? null, userAgent: meta.userAgent ?? null, userId: meta.userId ?? null }, verdicts, actor };
  const [filterRefused] = await guard('submission:filter', filterPayload);
  if(filterRefused) return [filterRefused, null];

  const clean = filterPayload.verdicts.map(cleanVerdict);
  const decision = decide(clean);
  if(decision.outcome === 'reject') return [{ code: 403, msg: decision.message }, null];

  const savePayload = { form, values: { ...result.values }, data: {}, meta: filterPayload.meta, extras, actor };
  const [saveRefused] = await guard('submission:before_save', savePayload);
  if(saveRefused) return [saveRefused, null];

  const id = newId();
  const fileFields = fields.filter(field => (field.type === 'file' || field.type === 'image') && result.visible.has(field.key));
  let stored = [];
  if(fileFields.length && Object.values(files).some(list => list?.length)){
    const [storeError, storage] = await storeFiles({ submissionId: id, formSlug: form.slug, fields: fileFields, files, userId: meta.userId, config });
    if(storeError) return [storeError, null];
    stored = storage.stored;
    Object.assign(savePayload.values, storage.keys);
  }

  const submission = {
    id,
    formId: form.id,
    formSlug: form.slug,
    formTitle: form.title,
    schema: snapshotOf(fields),
    values: savePayload.values,
    data: savePayload.data,
    status: decision.outcome === 'spam' ? 'spam' : 'new',
    statusBeforeTrash: null,
    spam: clean,
    ip: config.storeIp ? (meta.ip ?? null) : null,
    userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 255) : null,
    userId: meta.userId ?? null,
    createdAt: new Date(),
    erasedAt: null,
    trashedAt: null,
  };

  try {
    await db.transaction(async tx => {
      await tx.insert(kempoFormsSubmission).values(submission);
      await addEvent(id, 'created', { actor, data: { status: submission.status } }, tx);
    });
  } catch(error) {
    console.error(`[kempo-forms] A submission could not be saved: ${error.message}`);
    await removeFiles(stored);
    return [{ code: 500, msg: 'Your submission could not be saved. Please try again.' }, null];
  }

  await notify('submission:saved', { submission, form, actor });

  const deliver = async () => {
    if(submission.status !== 'new') return;
    try {
      await sendNotifications({ submission, form, config, actor });
      await sendConfirmation({ submission, form, config, actor });
    } catch(error) {
      console.error(`[kempo-forms] Notifying about a submission failed: ${error.message}`);
    }
  };
  if(wait) await deliver();
  else deliver();

  return [null, { id, message: form.successMessage, redirectUrl: form.redirectUrl }];
};
