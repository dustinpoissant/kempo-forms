import { eq, inArray } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsForm, kempoFormsSubmission } from '../../db/schema.js';
import { notify } from '../hooks.js';
import { purgeSubmissions } from '../submissions/manage.js';

/*
  The form Trash. Archiving a form (see save.js) puts it here; this removes forms for good, together with every submission they
  have, files included. Only an archived form can be removed, so nothing is deleted without having been through the Trash.

  `previewEmptyTrash` is what the confirmation shows: how many forms and how many submissions are about to go.
*/

export const previewEmptyTrash = async ({ ids = null } = {}) => {
  const forms = await db.select({ id: kempoFormsForm.id, title: kempoFormsForm.title }).from(kempoFormsForm).where(eq(kempoFormsForm.status, 'archived'));
  const chosen = ids ? forms.filter(form => ids.map(String).includes(form.id)) : forms;
  const submissions = chosen.length ? await db.select({ id: kempoFormsSubmission.id }).from(kempoFormsSubmission).where(inArray(kempoFormsSubmission.formId, chosen.map(form => form.id))) : [];
  return [null, { forms: chosen.length, submissions: submissions.length, titles: chosen.map(form => form.title) }];
};

export const emptyFormTrash = async ({ ids = null, actor = '' } = {}) => {
  const archived = await db.select().from(kempoFormsForm).where(eq(kempoFormsForm.status, 'archived'));
  const chosen = ids ? archived.filter(form => ids.map(String).includes(form.id)) : archived;

  let submissions = 0;
  for(const form of chosen){
    const rows = await db.select({ id: kempoFormsSubmission.id }).from(kempoFormsSubmission).where(eq(kempoFormsSubmission.formId, form.id));
    const [, result] = await purgeSubmissions({ ids: rows.map(row => row.id), actor });
    submissions += result?.purged ?? 0;
    await db.delete(kempoFormsForm).where(eq(kempoFormsForm.id, form.id));
    await notify('form:deleted', { formSlug: form.slug, actor });
  }
  return [null, { forms: chosen.length, submissions }];
};
