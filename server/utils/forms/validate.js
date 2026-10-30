import { validateFields } from '../fields/definition.js';
import { validateRules } from '../spam/rules.js';
import { isEmail, splitEmails } from '../emails.js';
import { TYPES } from '../fields/types.js';

/*
  What a form may be saved with, checked strictly, and cleaned to exactly what is stored.
*/

export const ACCOUNT_REQUIREMENTS = ['inherit', 'required', 'optional'];
export const MAX_RECIPIENTS = 10;

/* Names under /forms that are not forms: a form with one of these as its slug would shadow a page or a route. */
const RESERVED = ['api', 'components', 'utils', 'icons', 'sdk', 'index'];

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export const slugFrom = title => String(title ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/*
  A web address a visitor may be sent to after submitting: http(s), or a path on this site.
*/
const safeRedirect = value => /^https?:\/\/[^\s]+$/i.test(value) || /^\/(?!\/)[^\s]*$/.test(value);

export const validateForm = (input, { filesAvailable = true } = {}) => {
  const title = text(input.title, 200);
  if(!title) return [{ code: 400, msg: 'The form needs a title.' }, null];

  const slug = text(input.slug, 80) || slugFrom(title);
  if(!SLUG.test(slug)) return [{ code: 400, msg: 'The address can only use lowercase letters, numbers and single hyphens.' }, null];
  if(RESERVED.includes(slug)) return [{ code: 400, msg: `"${slug}" is reserved. Choose a different address.` }, null];

  const [fieldsError, fields] = validateFields(input.fields, { filesAvailable });
  if(fieldsError) return [fieldsError, null];

  const [rulesError, spamRules] = validateRules(input.spamRules, 'This form\'s spam rules');
  if(rulesError) return [rulesError, null];

  const accountRequirement = input.accountRequirement ?? 'inherit';
  if(!ACCOUNT_REQUIREMENTS.includes(accountRequirement)) return [{ code: 400, msg: 'The account requirement must be inherit, required or optional.' }, null];

  const notifyEmails = splitEmails(input.notifyEmails ?? []);
  const badEmail = notifyEmails.find(address => !isEmail(address));
  if(badEmail) return [{ code: 400, msg: `"${badEmail}" is not a valid email address.` }, null];
  if(notifyEmails.length > MAX_RECIPIENTS) return [{ code: 400, msg: `A form can have at most ${MAX_RECIPIENTS} recipients of its own.` }, null];

  const redirectUrl = text(input.redirectUrl, 2000) || null;
  if(redirectUrl && !safeRedirect(redirectUrl)) return [{ code: 400, msg: 'The redirect must be a web address starting with http:// or https://, or a path on this site starting with /.' }, null];

  const sendConfirmation = input.sendConfirmation === true;
  const confirmationField = text(input.confirmationField, 40) || null;
  if(sendConfirmation){
    const field = fields.find(entry => entry.key === confirmationField);
    if(!field || field.type !== 'email') return [{ code: 400, msg: 'To confirm by email, choose which email field holds the visitor\'s address.' }, null];
  }

  return [null, {
    slug,
    title,
    description: text(input.description, 2000),
    fields,
    submitLabel: text(input.submitLabel, 60) || 'Send',
    successMessage: text(input.successMessage, 2000) || 'Thank you. Your message has been sent.',
    redirectUrl,
    standalonePage: input.standalonePage !== false,
    accountRequirement,
    notifyEmails,
    useDefaultRecipients: input.useDefaultRecipients !== false,
    sendConfirmation,
    confirmationField,
    confirmationSubject: text(input.confirmationSubject, 200) || 'We received your message',
    confirmationMessage: text(input.confirmationMessage, 5000),
    spamRules,
  }];
};

export const typeList = () => Object.entries(TYPES).map(([key, type]) => ({ key, label: type.label, input: type.input, choices: Boolean(type.choices), text: Boolean(type.text), files: Boolean(type.files), rich: Boolean(type.rich) }));
