/*
  Browser client, served at /forms/sdk.js.

  Every call returns an `[error, data]` tuple like the rest of kempo. An error carries the extra fields a route sent with it:
  `errors` (the problem with each field) on a refused submission, and `retryAfter` on a rate limit.

  The first two calls are public. Everything under "Admin" needs a signed-in user holding the permission named beside it.
*/

const BASE = '/forms/api';
const ADMIN = `${BASE}/kempo-forms`;

const request = async (url, options = {}) => {
  try {
    const response = await fetch(url, { credentials: 'same-origin', ...options });
    const data = await response.json().catch(() => ({}));
    if(!response.ok){
      const { error, ...details } = data;
      return [{ code: response.status, msg: error || response.statusText, ...details }, null];
    }
    return [null, data];
  } catch(error) {
    return [{ code: 0, msg: error.message }, null];
  }
};

const send = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

export const query = params => {
  const search = new URLSearchParams();
  for(const [key, value] of Object.entries(params || {})){
    if(value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

/*
  Public
*/

export const getPublicForm = slug => request(`${BASE}/forms/${encodeURIComponent(slug)}`);

/*
  `files` is { [field key]: [File] }. With none, the submission goes as JSON; with some, as multipart.
*/
export const sendForm = (slug, { values, extras = {}, files = {} }) => {
  const url = `${BASE}/forms/${encodeURIComponent(slug)}/submit`;
  const any = Object.values(files).some(list => list.length);
  if(!any) return request(url, send('POST', { values, extras }));

  const data = new FormData();
  data.append('values', JSON.stringify(values));
  data.append('extras', JSON.stringify(extras));
  for(const [key, list] of Object.entries(files)) for(const file of list) data.append(key, file, file.name);
  return request(url, { method: 'POST', body: data });
};

/*
  Admin: forms (forms:forms:view to read, forms:forms:manage to change)
*/

export const getMeta = () => request(`${ADMIN}/meta`);
export const listForms = (params = {}) => request(`${ADMIN}/forms${query(params)}`);
export const getForm = id => request(`${ADMIN}/forms/${encodeURIComponent(id)}`);
export const createForm = input => request(`${ADMIN}/forms`, send('POST', input));
export const updateForm = (id, changes) => request(`${ADMIN}/forms/${encodeURIComponent(id)}`, send('PUT', changes));
export const setFormStatus = (id, status) => request(`${ADMIN}/forms/${encodeURIComponent(id)}/status`, send('POST', { status }));
export const duplicateForm = id => request(`${ADMIN}/forms/${encodeURIComponent(id)}/duplicate`, send('POST'));

/*
  Admin: the Trash
*/

export const getTrash = () => request(`${ADMIN}/trash`);
export const previewEmptyTrash = () => request(`${ADMIN}/trash/preview`);
export const emptyTrash = ({ forms = false, submissions = false, ids = null } = {}) => request(`${ADMIN}/trash/empty`, send('POST', { forms, submissions, ...(ids ? { ids } : {}) }));

/*
  Admin: submissions (forms:submissions:view to read, forms:submissions:manage to change)
*/

export const listSubmissions = (params = {}) => request(`${ADMIN}/submissions${query(params)}`);
export const listSubmissionForms = () => request(`${ADMIN}/submissions/forms`);
export const countSubmissions = (params = {}) => request(`${ADMIN}/submissions/counts${query(params)}`);
export const exportUrl = (params = {}) => `${ADMIN}/submissions/export${query(params)}`;
export const getSubmission = id => request(`${ADMIN}/submissions/${encodeURIComponent(id)}`);
export const setSubmissionStatus = (ids, status, reason = '') => request(`${ADMIN}/submissions/status`, send('POST', { ids, status, reason }));
export const addNote = (id, note) => request(`${ADMIN}/submissions/${encodeURIComponent(id)}/note`, send('POST', { note }));
export const resendNotification = id => request(`${ADMIN}/submissions/${encodeURIComponent(id)}/resend`, send('POST'));
export const trashSubmissions = ids => request(`${ADMIN}/submissions/trash`, send('POST', { ids }));
export const restoreSubmissions = ids => request(`${ADMIN}/submissions/restore`, send('POST', { ids }));

/*
  Admin: settings (forms:settings:manage), the spam rule tester, and people's data
*/

export const getSettings = () => request(`${ADMIN}/settings`);
export const saveSettings = settings => request(`${ADMIN}/settings`, send('PUT', settings));
export const testRules = (rules, sample) => request(`${ADMIN}/spam/test`, send('POST', { rules, sample }));
export const findPerson = email => request(`${ADMIN}/privacy/find${query({ email })}`);
export const exportPersonUrl = email => `${ADMIN}/privacy/export${query({ email })}`;
export const erasePerson = email => request(`${ADMIN}/privacy/erase`, send('POST', { email }));
export const getSummary = () => request(`${ADMIN}/summary`);
