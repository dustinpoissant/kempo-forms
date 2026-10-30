/*
  Server-side entry point — what captcha, spam, delivery and CRM extensions import.

  ```js
  import { submitForm, getSubmission, setSubmissionStatus, setSubmissionData } from 'kempo-forms/sdk';

  // Keep a score with the submission so the admin can show it.
  await setSubmissionData({ id: submission.id, key: 'my-extension:score', value: 0.12, actor: 'my-extension' });
  ```

  Every function returns `[error, data]` with `error = { code, msg }`, and none throws. These are data operations with **no
  permission checks of their own**: the routes decide who may do what, and anything calling in here is server-side code that has
  already decided it is allowed. Everything that changes something takes an optional `{ actor }` (your extension's name), which
  is written to the submission's history.

  Extending forms is done with hooks (see README.md for every one): `kempo-forms:submission:filter` to add a spam verdict
  (a captcha, an AI score), `submission:before_save` to refuse or change a submission, `submission:saved` to deliver it
  somewhere else, `submission:notify` to change who is emailed, `submission:erased` to delete the personal data you keep, and
  `form:before_save` and `form:saved` to follow the forms themselves.
*/

export { getForm, getFormBySlug, listForms } from './server/utils/forms/read.js';
export { createForm, updateForm, setFormStatus, duplicateForm } from './server/utils/forms/save.js';
export { emptyFormTrash, previewEmptyTrash } from './server/utils/forms/trash.js';

export { default as submitForm } from './server/utils/submissions/submit.js';
export { getSubmission, getSubmissionDetail, listSubmissions, countByStatus } from './server/utils/submissions/read.js';
export {
  setSubmissionStatus,
  addSubmissionNote,
  setSubmissionData,
  trashSubmissions,
  restoreSubmissions,
  purgeSubmissions,
  emptySubmissionTrash,
  resendNotification,
} from './server/utils/submissions/manage.js';
export { default as exportSubmissionsCsv } from './server/utils/submissions/csv.js';

export { findMatches, requestErasure } from './server/utils/privacy/erase.js';
export { testRules } from './server/utils/spam/rules.js';

export { readConfig, OWNER } from './server/utils/config/settings.js';
export { runSweep } from './server/utils/sweeps.js';
