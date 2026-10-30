import { and, desc, eq, ilike, inArray, ne, or, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsForm, kempoFormsSubmission } from '../../db/schema.js';

/*
  Reading forms. A form is returned as stored; the counts are added by listForms and getForm, because the editor warns before
  a field that submissions still use is removed.
*/

const counts = async formIds => {
  if(!formIds.length) return new Map();
  const rows = await db.select({
    formId: kempoFormsSubmission.formId,
    total: sql`count(*) filter (where ${kempoFormsSubmission.status} <> 'trashed')::int`,
    unread: sql`count(*) filter (where ${kempoFormsSubmission.status} = 'new')::int`,
    last: sql`max(${kempoFormsSubmission.createdAt}) filter (where ${kempoFormsSubmission.status} <> 'trashed')`,
    trashed: sql`count(*) filter (where ${kempoFormsSubmission.status} = 'trashed')::int`,
  }).from(kempoFormsSubmission).where(inArray(kempoFormsSubmission.formId, formIds)).groupBy(kempoFormsSubmission.formId);
  return new Map(rows.map(row => [row.formId, { submissionCount: row.total, newCount: row.unread, lastSubmissionAt: row.last, trashedCount: row.trashed }]));
};

const withCounts = (form, map) => ({ submissionCount: 0, newCount: 0, lastSubmissionAt: null, trashedCount: 0, ...map.get(form.id), ...form });

export const getForm = async ({ id }) => {
  if(!id) return [{ code: 400, msg: 'A form id is required' }, null];
  const [form] = await db.select().from(kempoFormsForm).where(eq(kempoFormsForm.id, String(id))).limit(1);
  if(!form) return [{ code: 404, msg: 'Form not found' }, null];
  return [null, withCounts(form, await counts([form.id]))];
};

export const getFormBySlug = async ({ slug }) => {
  if(!slug) return [{ code: 400, msg: 'A form address is required' }, null];
  const [form] = await db.select().from(kempoFormsForm).where(eq(kempoFormsForm.slug, String(slug))).limit(1);
  if(!form) return [{ code: 404, msg: 'Form not found' }, null];
  return [null, form];
};

/*
  `status` is live, paused, archived, or '' for every form that is not in the Trash. `search` matches the title and address.
*/
export const listForms = async ({ status = '', search = '', limit = 25, offset = 0 } = {}) => {
  const take = Math.min(Math.max(Number.parseInt(limit, 10) || 25, 1), 200);
  const skip = Math.max(Number.parseInt(offset, 10) || 0, 0);

  const filters = [status ? eq(kempoFormsForm.status, status) : ne(kempoFormsForm.status, 'archived')];
  if(search){
    const like = `%${String(search).replace(/[\\%_]/g, '\\$&')}%`;
    filters.push(or(ilike(kempoFormsForm.title, like), ilike(kempoFormsForm.slug, like)));
  }
  const where = and(...filters);

  const [{ total }] = await db.select({ total: sql`count(*)::int` }).from(kempoFormsForm).where(where);
  const forms = await db.select().from(kempoFormsForm).where(where).orderBy(desc(kempoFormsForm.updatedAt)).limit(take).offset(skip);
  const map = await counts(forms.map(form => form.id));
  return [null, { total, items: forms.map(form => withCounts(form, map)) }];
};
