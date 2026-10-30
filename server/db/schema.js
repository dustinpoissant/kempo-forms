import { pgTable, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

/*
  Five tables: the forms, what was sent to them, the history of each submission, the attempts the rate limit counts, and the
  record of every erasure request.

  The indexes declared here are created by hand in install.js as well. kempo's installer makes columns and primary keys from a
  Drizzle schema and nothing else, and the unique one on `slug` is what keeps two forms from sharing an address. A static test
  checks the two lists agree. There are no foreign keys for the same reason: they would exist on a developer's database and
  nowhere else, so the code enforces what they would.
*/

/*
  A form. `fields` is the ordered list of field definitions (see server/utils/fields/definition.js), `status` is `live`,
  `paused` or `archived` (an archived form is in the Trash).
*/
export const kempoFormsForm = pgTable('kempoFormsForm', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  fields: jsonb('fields').notNull().default([]),
  submitLabel: text('submitLabel').notNull().default('Send'),
  successMessage: text('successMessage').notNull().default('Thank you. Your message has been sent.'),
  redirectUrl: text('redirectUrl'),
  status: text('status').notNull().default('live'),
  standalonePage: boolean('standalonePage').notNull().default(true),
  accountRequirement: text('accountRequirement').notNull().default('inherit'),
  notifyEmails: jsonb('notifyEmails').notNull().default([]),
  useDefaultRecipients: boolean('useDefaultRecipients').notNull().default(true),
  sendConfirmation: boolean('sendConfirmation').notNull().default(false),
  confirmationField: text('confirmationField'),
  confirmationSubject: text('confirmationSubject').notNull().default('We received your message'),
  confirmationMessage: text('confirmationMessage').notNull().default(''),
  spamRules: jsonb('spamRules').notNull().default([]),
  createdBy: text('createdBy'),
  createdAt: timestamp('createdAt').notNull(),
  updatedAt: timestamp('updatedAt').notNull(),
  archivedAt: timestamp('archivedAt'),
}, table => [
  uniqueIndex('kempoFormsForm_slug_idx').on(table.slug),
  index('kempoFormsForm_status_idx').on(table.status),
]);

/*
  One submission. `schema` is a copy of the form's fields as they were when it was sent, so editing or deleting a field later
  never makes an old submission unreadable. `values` holds only the keys the form declared, normalised to their stored form,
  and only for fields that were visible. `data` belongs to extensions, written through `setSubmissionData`.

  `status` is `new`, `read`, `spam` or `trashed`; a trashed submission remembers the status it had in `statusBeforeTrash` so
  restoring it puts it back. `spam` is every verdict that touched it. `ip` is only ever set when the `store_ip` setting is on.
  `erasedAt` is set when its personal fields were erased.
*/
export const kempoFormsSubmission = pgTable('kempoFormsSubmission', {
  id: text('id').primaryKey(),
  formId: text('formId').notNull(),
  formSlug: text('formSlug').notNull(),
  formTitle: text('formTitle').notNull(),
  schema: jsonb('schema').notNull().default([]),
  values: jsonb('values').notNull().default({}),
  data: jsonb('data').notNull().default({}),
  status: text('status').notNull().default('new'),
  statusBeforeTrash: text('statusBeforeTrash'),
  spam: jsonb('spam').notNull().default([]),
  ip: text('ip'),
  userAgent: text('userAgent'),
  userId: text('userId'),
  createdAt: timestamp('createdAt').notNull(),
  erasedAt: timestamp('erasedAt'),
  trashedAt: timestamp('trashedAt'),
}, table => [
  index('kempoFormsSubmission_form_idx').on(table.formId, table.createdAt),
  index('kempoFormsSubmission_status_idx').on(table.status, table.createdAt),
  index('kempoFormsSubmission_created_idx').on(table.createdAt),
  index('kempoFormsSubmission_user_idx').on(table.userId),
]);

/*
  The history of one submission. `type` is `created`, `read`, `status_changed`, `note`, `data_set`, `notified` (one per
  recipient), `confirmation`, `erased`, `trashed`, `restored` or `form_archived`. `actor` is the extension that made the change
  through the SDK, or '' for a person. `data` never holds a personal value: an erasure records the keys it removed, not what
  was in them.
*/
export const kempoFormsSubmissionEvent = pgTable('kempoFormsSubmissionEvent', {
  id: text('id').primaryKey(),
  submissionId: text('submissionId').notNull(),
  at: timestamp('at').notNull(),
  actor: text('actor').notNull().default(''),
  type: text('type').notNull(),
  data: jsonb('data').notNull().default({}),
}, table => [
  index('kempoFormsSubmissionEvent_submission_idx').on(table.submissionId, table.at),
]);

/*
  One row per submission attempt, accepted or not, with the address hashed with a per-site salt. It exists only so the rate
  limit can count, and the sweep removes it after a day.
*/
export const kempoFormsAttempt = pgTable('kempoFormsAttempt', {
  id: text('id').primaryKey(),
  ipHash: text('ipHash').notNull(),
  at: timestamp('at').notNull(),
  bytes: integer('bytes').notNull().default(0),
}, table => [
  index('kempoFormsAttempt_ip_idx').on(table.ipHash, table.at),
  index('kempoFormsAttempt_at_idx').on(table.at),
]);

/*
  A request to erase someone's personal data. The email is never stored, only a salted hash of it, so the record of the request
  holds no personal data (kempo-oauth's deletion record follows the same rule). `source` is `account` (kempo fired
  `user:deleted`) or `admin` (someone asked the owner directly). `status` is `pending`, `done` or `failed`; the sweep retries
  the ones that are not done.
*/
export const kempoFormsErasure = pgTable('kempoFormsErasure', {
  id: text('id').primaryKey(),
  emailHash: text('emailHash').notNull(),
  userId: text('userId'),
  source: text('source').notNull(),
  status: text('status').notNull().default('pending'),
  matched: integer('matched').notNull().default(0),
  error: text('error'),
  createdAt: timestamp('createdAt').notNull(),
  completedAt: timestamp('completedAt'),
}, table => [
  index('kempoFormsErasure_status_idx').on(table.status, table.createdAt),
]);
