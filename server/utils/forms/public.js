import { readConfig } from '../config/settings.js';
import { effectiveFields } from '../fields/types.js';
import filesAvailable from '../files/available.js';
import { getFormBySlug } from './read.js';

/*
  What a visitor may know about a form: how to draw it, and nothing about where its submissions go. No recipients, no spam rules,
  no field is marked personal, and no setting is exposed beyond the limits the page needs to explain itself.

  A form that is paused still answers, as `closed`, so the page can say so instead of looking broken. A form in the Trash
  does not exist as far as a visitor can tell.
*/

const FIELD_PROPERTIES = ['key', 'label', 'type', 'required', 'placeholder', 'hint', 'options', 'pattern', 'minLength', 'maxLength', 'showWhen', 'settings'];

const pick = field => Object.fromEntries(FIELD_PROPERTIES.filter(name => field[name] !== undefined).map(name => [name, field[name]]));

export default async ({ slug, userId = null }) => {
  const [error, form] = await getFormBySlug({ slug });
  if(error || form.status === 'archived') return [{ code: 404, msg: 'This form does not exist.' }, null];

  const config = await readConfig();
  const available = Boolean(await filesAvailable());
  const needsAccount = form.accountRequirement === 'required' || (form.accountRequirement === 'inherit' && config.requireAccount);

  return [null, {
    slug: form.slug,
    title: form.title,
    description: form.description,
    submitLabel: form.submitLabel,
    closed: form.status !== 'live',
    standalone: form.standalonePage,
    needsAccount,
    signedIn: Boolean(userId),
    fields: effectiveFields(form.fields, { richText: config.richText, filesAvailable: available }).map(pick),
    limits: { maxFieldLength: config.maxFieldLength, uploadMaxBytes: config.uploadMaxBytes, uploadMaxFiles: config.uploadMaxFiles },
    honeypot: 'website_url',
  }];
};
