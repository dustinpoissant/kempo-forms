import { isEmail, splitEmails } from '../emails.js';
import { validateRules } from '../spam/rules.js';
import { RICH_TEXT_MODES, SETTING_NAMES, SPAM_ACTIONS } from './settings.js';
import hasEmailTransport from './transport.js';

/*
  What the settings screen may save, checked strictly. The normalisers in settings.js are forgiving on purpose — a bad stored
  value falls back to the default rather than breaking the pipeline — but a value somebody is typing in right now gets told what
  is wrong with it instead.
*/

const KEYS = Object.fromEntries(Object.entries(SETTING_NAMES).map(([key, name]) => [name, key]));

const number = (label, min, max) => value => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? [null, parsed]
    : [{ code: 400, msg: `${label} must be a whole number from ${min} to ${max}` }, null];
};

const boolean = label => value => typeof value === 'boolean' ? [null, value] : [{ code: 400, msg: `${label} must be on or off` }, null];

const choice = (label, allowed) => value => allowed.includes(value) ? [null, value] : [{ code: 400, msg: `${label} must be one of: ${allowed.join(', ')}` }, null];

export const VALIDATORS = {
  site_url: value => typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value.trim())
    ? [null, value.trim().replace(/\/+$/, '')]
    : [{ code: 400, msg: 'The site address must start with http:// or https://' }, null],
  default_recipients: value => {
    if(typeof value !== 'string') return [{ code: 400, msg: 'The recipients must be text' }, null];
    const list = splitEmails(value);
    const bad = list.find(address => !isEmail(address));
    if(bad) return [{ code: 400, msg: `"${bad}" is not a valid email address` }, null];
    if(list.length > 50) return [{ code: 400, msg: 'At most 50 site-wide recipients' }, null];
    return [null, list.join(', ')];
  },
  email_notifications: boolean('Email notifications'),
  require_account: boolean('Requiring an account'),
  spam_action: choice('The spam action', SPAM_ACTIONS),
  spam_rules: value => {
    const [error, clean] = validateRules(value, 'The site-wide spam rules');
    return error ? [error, null] : [null, clean];
  },
  rate_limit_per_hour: number('The hourly limit', 0, 100000),
  max_field_length: number('The longest field', 1, 100000),
  store_ip: boolean('Storing the IP address'),
  trust_proxy: boolean('Trusting the proxy'),
  retention_days: number('Retention', 0, 36500),
  spam_retention_days: number('Spam retention', 0, 36500),
  rich_text: choice('Rich text', RICH_TEXT_MODES),
  upload_max_bytes: number('The largest upload', 1, 1000000000),
  upload_max_files: number('The most files', 1, 50),
};

/*
  `[error, updates]` — the settings in `body` that are known, each validated. Unknown names are an error rather than ignored: a
  typo in a setting name should not look like a save that worked. Turning email notifications on needs an email extension.
*/
export const validateSettings = async body => {
  if(!body || typeof body !== 'object' || Array.isArray(body)) return [{ code: 400, msg: 'Send the settings as an object' }, null];

  const updates = {};
  for(const [name, value] of Object.entries(body)){
    if(!KEYS[name] || !VALIDATORS[name]) return [{ code: 400, msg: `"${name}" is not a forms setting` }, null];
    const [error, clean] = VALIDATORS[name](value);
    if(error) return [error, null];
    updates[name] = clean;
  }

  if(!Object.keys(updates).length) return [{ code: 400, msg: 'Nothing to save' }, null];

  if(updates.email_notifications === true && !(await hasEmailTransport())){
    return [{ code: 409, msg: 'Install an email extension such as kempo-resend or kempo-smtp first. Email notifications need one to send anything.' }, null];
  }
  return [null, updates];
};
