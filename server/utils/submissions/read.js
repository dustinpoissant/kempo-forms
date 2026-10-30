import { and, desc, eq, gte, ilike, inArray, lt, ne, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsSubmission } from '../../db/schema.js';
import { listEvents } from './events.js';
import { rowsOf } from './present.js';

/*
  Reading submissions. A list never includes the history; one submission read on its own comes with its rows (each value with its
  label) and its events.
*/

export const STATUSES = ['new', 'read', 'spam', 'trashed'];

export const getSubmission = async ({ id }) => {
  if(!id) return [{ code: 400, msg: 'A submission id is required' }, null];
  const [submission] = await db.select().from(kempoFormsSubmission).where(eq(kempoFormsSubmission.id, String(id))).limit(1);
  if(!submission) return [{ code: 404, msg: 'Submission not found' }, null];
  return [null, submission];
};

export const getSubmissionDetail = async ({ id }) => {
  const [error, submission] = await getSubmission({ id });
  if(error) return [error, null];
  return [null, { ...submission, rows: rowsOf(submission.schema, submission.values), events: await listEvents(submission.id) }];
};

const escapeLike = value => `%${String(value).replace(/[\\%_]/g, '\\$&')}%`;

/*
  The conditions the admin's filters turn into. `status` is a status, or '' for every submission that is not spam or in the Trash.
  `search` looks in the values and the form's title. `from` and `to` are dates (inclusive).
*/
export const filtersFor = ({ formId, status = '', search = '', from = '', to = '', userId = '' } = {}) => {
  const filters = [];
  if(formId) filters.push(eq(kempoFormsSubmission.formId, String(formId)));
  if(userId) filters.push(eq(kempoFormsSubmission.userId, String(userId)));
  if(status && STATUSES.includes(status)) filters.push(eq(kempoFormsSubmission.status, status));
  else filters.push(inArray(kempoFormsSubmission.status, ['new', 'read']));
  if(search){
    filters.push(sql`(${kempoFormsSubmission.values}::text ilike ${escapeLike(search)} or ${kempoFormsSubmission.formTitle} ilike ${escapeLike(search)})`);
  }
  if(from && !Number.isNaN(Date.parse(from))) filters.push(gte(kempoFormsSubmission.createdAt, new Date(from)));
  if(to && !Number.isNaN(Date.parse(to))) filters.push(lt(kempoFormsSubmission.createdAt, new Date(Date.parse(to) + 24 * 60 * 60 * 1000)));
  return and(...filters);
};

export const listSubmissions = async ({ limit = 25, offset = 0, ...filters } = {}) => {
  const take = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 1000);
  const skip = Math.max(Number.parseInt(offset, 10) || 0, 0);
  const where = filtersFor(filters);

  const [{ total }] = await db.select({ total: sql`count(*)::int` }).from(kempoFormsSubmission).where(where);
  const items = await db.select().from(kempoFormsSubmission).where(where).orderBy(desc(kempoFormsSubmission.createdAt), desc(kempoFormsSubmission.id)).limit(take).offset(skip);
  return [null, { total, items }];
};

/*
  How many submissions are in each tab, for the admin's tab labels and the dashboard widget.
*/
export const countByStatus = async ({ formId } = {}) => {
  const rows = await db.select({ status: kempoFormsSubmission.status, count: sql`count(*)::int` }).from(kempoFormsSubmission)
    .where(formId ? eq(kempoFormsSubmission.formId, String(formId)) : sql`true`).groupBy(kempoFormsSubmission.status);
  const counts = { new: 0, read: 0, spam: 0, trashed: 0 };
  for(const row of rows) counts[row.status] = row.count;
  return counts;
};

export const countSince = async since => {
  const [row] = await db.select({ count: sql`count(*)::int` }).from(kempoFormsSubmission)
    .where(and(gte(kempoFormsSubmission.createdAt, since), ne(kempoFormsSubmission.status, 'spam'), ne(kempoFormsSubmission.status, 'trashed')));
  return row?.count ?? 0;
};
