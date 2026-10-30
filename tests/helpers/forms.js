import path from 'path';
import { fileURLToPath } from 'url';
import { like } from 'drizzle-orm';
import { createHook, clearHandlerCache, setSetting } from 'kempo/server/sdk.js';
import { hook, setting, email } from 'kempo/server/db/schema.js';
import { kempoFormsAttempt, kempoFormsErasure, kempoFormsForm, kempoFormsSubmission, kempoFormsSubmissionEvent } from '../../server/db/schema.js';
import { createForm } from '../../server/utils/forms/save.js';
import submit from '../../server/utils/submissions/submit.js';
import { db } from './db.js';

/*
  What the suites share: a reset, a form that exists, and the hooks a test can listen to.
*/

const here = path.dirname(fileURLToPath(import.meta.url));

export const purge = async () => {
  await db.delete(setting).where(like(setting.name, 'kempo-forms:%'));
  await db.delete(kempoFormsSubmissionEvent);
  await db.delete(kempoFormsSubmission);
  await db.delete(kempoFormsAttempt);
  await db.delete(kempoFormsErasure);
  await db.delete(kempoFormsForm);
  await db.delete(email);
};

export const withSettings = async (settings, run) => {
  for(const [name, value, type] of settings) await setSetting('kempo-forms', name, value, type, false, null);
  try {
    return await run();
  } finally {
    await db.delete(setting).where(like(setting.name, 'kempo-forms:%'));
  }
};

export const slug = () => `form-${Math.random().toString(36).slice(2, 10)}`;

export const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'message', label: 'Message', type: 'textarea', required: false },
];

export const makeForm = async (input = {}) => {
  const [error, form] = await createForm({ input: { title: 'Contact', slug: slug(), fields: FIELDS, ...input } });
  if(error) throw new Error(`makeForm: ${error.msg}`);
  return form;
};

export const send = (form, values, extra = {}) => submit({ slug: form.slug, values, wait: true, ...extra });

export const ADA = { name: 'Ada Lovelace', email: 'ada@example.com', message: 'Hello there' };

/*
  Hooks. A fixture module per event records what it was given and does whatever the test says. The hook rows point at the
  modules by absolute path, which triggerHook imports as-is.
*/
const FIXTURES = {
  'kempo-forms:submission:filter': 'filter',
  'kempo-forms:submission:before_save': 'before-save',
  'kempo-forms:submission:saved': 'saved',
  'kempo-forms:submission:notify': 'notify',
  'kempo-forms:submission:sent': 'sent',
  'kempo-forms:submission:erased': 'erased',
  'kempo-forms:form:before_save': 'form-before-save',
  'kempo-forms:form:saved': 'form-saved',
  'kempo-forms:email:context': 'email-context',
  'email:send': 'email-send',
};

export const listen = async (events = Object.keys(FIXTURES)) => {
  await db.delete(hook).where(like(hook.owner, 'kempo-forms-test%'));
  for(const event of events) await createHook({ owner: 'kempo-forms-test', event, callback: path.join(here, '..', 'fixtures', 'hooks', `${FIXTURES[event]}.js`) });
  clearHandlerCache();
  globalThis.kempoFormsCalls = [];
  globalThis.kempoFormsHandlers = {};
};

export const stopListening = async () => {
  await db.delete(hook).where(like(hook.owner, 'kempo-forms-test%'));
  clearHandlerCache();
  globalThis.kempoFormsCalls = [];
  globalThis.kempoFormsHandlers = {};
};

export const handle = (event, handler) => {
  globalThis.kempoFormsHandlers[event] = handler;
};

export const heard = event => (globalThis.kempoFormsCalls || []).filter(call => call.event === event);

export { db };
