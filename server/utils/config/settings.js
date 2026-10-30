import { getSetting } from 'kempo/server/sdk.js';
import { splitEmails } from '../emails.js';

/*
  Every setting, read and made safe to use in one place.

  Each is editable on the settings screen, so everything the rest of the extension sees has been through a normaliser here, with
  the declared default behind it. A value that is not usable falls back rather than breaking the pipeline.
*/

export const OWNER = 'kempo-forms';

export const RICH_TEXT_MODES = ['off', 'markdown', 'html'];
export const SPAM_ACTIONS = ['spam', 'reject'];

/*
  The same values kempo-config.json declares, as the real types. A static test checks they agree.
*/
export const DEFAULTS = {
  siteUrl: 'http://localhost:3000',
  defaultRecipients: '',
  emailNotifications: false,
  requireAccount: false,
  spamAction: 'spam',
  spamRules: [],
  rateLimitPerHour: 10,
  maxFieldLength: 5000,
  storeIp: false,
  trustProxy: false,
  retentionDays: 0,
  spamRetentionDays: 30,
  richText: 'markdown',
  uploadMaxBytes: 10485760,
  uploadMaxFiles: 5,
};

export const SETTING_NAMES = {
  siteUrl: 'site_url',
  defaultRecipients: 'default_recipients',
  emailNotifications: 'email_notifications',
  requireAccount: 'require_account',
  spamAction: 'spam_action',
  spamRules: 'spam_rules',
  rateLimitPerHour: 'rate_limit_per_hour',
  maxFieldLength: 'max_field_length',
  storeIp: 'store_ip',
  trustProxy: 'trust_proxy',
  retentionDays: 'retention_days',
  spamRetentionDays: 'spam_retention_days',
  richText: 'rich_text',
  uploadMaxBytes: 'upload_max_bytes',
  uploadMaxFiles: 'upload_max_files',
};

/*
  A count that must be a whole number, at least `min`. Anything else is the default: a limit typed as "ten" is a typo, and the
  default is the value the site was installed with.
*/
const count = (value, fallback, min = 0) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= min ? number : fallback;
};

const flag = (value, fallback) => {
  if(typeof value === 'boolean') return value;
  if(value === 'true') return true;
  if(value === 'false') return false;
  return fallback;
};

const choice = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

export const NORMALISE = {
  siteUrl: value => typeof value === 'string' && /^https?:\/\//.test(value.trim()) ? value.trim().replace(/\/+$/, '') : DEFAULTS.siteUrl,
  defaultRecipients: value => typeof value === 'string' ? splitEmails(value).join(', ') : DEFAULTS.defaultRecipients,
  emailNotifications: value => flag(value, DEFAULTS.emailNotifications),
  requireAccount: value => flag(value, DEFAULTS.requireAccount),
  spamAction: value => choice(value, SPAM_ACTIONS, DEFAULTS.spamAction),
  spamRules: value => Array.isArray(value) ? value.filter(rule => rule && typeof rule === 'object') : DEFAULTS.spamRules,
  rateLimitPerHour: value => count(value, DEFAULTS.rateLimitPerHour),
  maxFieldLength: value => count(value, DEFAULTS.maxFieldLength, 1),
  storeIp: value => flag(value, DEFAULTS.storeIp),
  trustProxy: value => flag(value, DEFAULTS.trustProxy),
  retentionDays: value => count(value, DEFAULTS.retentionDays),
  spamRetentionDays: value => count(value, DEFAULTS.spamRetentionDays),
  richText: value => choice(value, RICH_TEXT_MODES, DEFAULTS.richText),
  uploadMaxBytes: value => count(value, DEFAULTS.uploadMaxBytes, 1),
  uploadMaxFiles: value => count(value, DEFAULTS.uploadMaxFiles, 1),
};

export const readConfig = async () => {
  const keys = Object.keys(DEFAULTS);

  const values = await Promise.all(keys.map(async key => {
    const [error, value] = await getSetting(OWNER, SETTING_NAMES[key], DEFAULTS[key]);
    return NORMALISE[key](error ? DEFAULTS[key] : value);
  }));

  return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
};
