import { sendEmailFromTemplate, getSetting } from 'kempo/server/sdk.js';
import { guard, notify } from '../hooks.js';
import { addEvent } from '../submissions/events.js';
import { escapeHtml, rowsOf } from '../submissions/present.js';
import { isEmail, splitEmails } from '../emails.js';

/*
  Emailing a new submission, and confirming it to the person who sent it.

  Both are off unless the `email_notifications` setting is on, which the settings screen only allows once an email extension
  that handles `email:send` is installed. kempo does the sending (and keeps the log, and retries): this builds the message and
  hands it over, then records what happened on the submission's history.

  Values are escaped here, before they reach the templates, because a template inserts `{{value}}` exactly as it is given.
*/

export const NOTIFICATION_TEMPLATE = 'kempo-forms/submission-notification';
export const CONFIRMATION_TEMPLATE = 'kempo-forms/submission-confirmation';

const oneLine = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 200);

const siteName = async () => String((await getSetting('system', 'site_name', 'this site'))[1] || 'this site');

/*
  Who gets a notification: the form's own recipients and, when it uses them, the site-wide ones, without duplicates.
*/
export const recipientsFor = (form, config) => [...new Set([
  ...(form.notifyEmails || []),
  ...(form.useDefaultRecipients ? splitEmails(config.defaultRecipients) : []),
])].filter(isEmail);

/*
  The address the visitor gave, if the form has an email field they answered.
*/
export const submitterAddress = submission => {
  const field = submission.schema.find(entry => entry.type === 'email' && typeof submission.values[entry.key] === 'string');
  return field ? submission.values[field.key] : null;
};

const send = async ({ to, subject, template, data, replyTo = null }) => {
  const [error] = await sendEmailFromTemplate({ to, subject, template, data, replyTo });
  return error ? { ok: false, error: String(error.msg || 'The email could not be sent').slice(0, 300) } : { ok: true };
};

export const sendNotifications = async ({ submission, form, config, actor = '' }) => {
  if(!config.emailNotifications) return [null, { sent: 0, failed: 0, skipped: 'off' }];

  const payload = { submission, form, recipients: recipientsFor(form, config) };
  const [refused] = await guard('submission:notify', payload);
  if(refused){
    await addEvent(submission.id, 'notified', { actor, data: { ok: false, error: refused.msg } });
    return [null, { sent: 0, failed: 0, skipped: 'refused' }];
  }

  const recipients = [...new Set(payload.recipients.map(address => String(address).trim().toLowerCase()))].filter(isEmail);
  if(!recipients.length) return [null, { sent: 0, failed: 0, skipped: 'nobody' }];

  /* Only an address kempo will accept as one: a refused reply-to would stop the whole notification. kempo up to 4.9.12 ignores it. */
  const visitor = submitterAddress(submission);
  const replyTo = isEmail(visitor) ? visitor.trim() : null;
  const context = {
    siteName: escapeHtml(await siteName()),
    formTitle: escapeHtml(submission.formTitle),
    rows: rowsOf(submission.schema, submission.values).map(row => ({ label: escapeHtml(row.label), html: row.html })),
    hasRows: Object.keys(submission.values).length > 0,
    link: `${config.siteUrl}/admin/extension/kempo-forms/submission/?id=${encodeURIComponent(submission.id)}`,
    hasReplyTo: Boolean(replyTo),
    replyTo: replyTo ? escapeHtml(replyTo) : '',
    submittedAt: escapeHtml(submission.createdAt.toUTCString()),
  };
  const [contextRefused] = await guard('email:context', { submission, form, template: NOTIFICATION_TEMPLATE, context });
  if(contextRefused){
    await addEvent(submission.id, 'notified', { actor, data: { ok: false, error: contextRefused.msg } });
    return [null, { sent: 0, failed: 0, skipped: 'refused' }];
  }

  let sent = 0;
  let failed = 0;
  for(const to of recipients){
    const result = await send({ to, subject: `New submission: ${oneLine(submission.formTitle)}`, template: NOTIFICATION_TEMPLATE, data: context, replyTo });
    result.ok ? sent++ : failed++;
    await addEvent(submission.id, 'notified', { actor, data: { recipient: to, ...result } });
    await notify('submission:sent', { submission, recipient: to, ok: result.ok, error: result.error ?? null });
  }
  return [null, { sent, failed }];
};

/*
  The "we received your message" email, for forms that ask for it. It goes to the visitor's own address, so the event records
  whether it worked but never the address.
*/
export const sendConfirmation = async ({ submission, form, config, actor = '' }) => {
  if(!config.emailNotifications || !form.sendConfirmation || !form.confirmationField) return [null, { sent: false }];

  const address = submission.values[form.confirmationField];
  if(typeof address !== 'string' || !isEmail(address)) return [null, { sent: false }];

  const result = await send({
    to: address,
    subject: oneLine(form.confirmationSubject) || 'We received your message',
    template: CONFIRMATION_TEMPLATE,
    data: {
      siteName: escapeHtml(await siteName()),
      formTitle: escapeHtml(form.title),
      hasMessage: Boolean(form.confirmationMessage),
      message: escapeHtml(form.confirmationMessage).replaceAll('\n', '<br>'),
    },
  });
  await addEvent(submission.id, 'confirmation', { actor, data: result });
  return [null, { sent: result.ok }];
};
