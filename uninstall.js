import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsForm, kempoFormsSubmission } from './server/db/schema.js';

/*
  Nothing here is deleted. Uninstalling without purging leaves every table in place, so reinstalling brings every form and
  submission back; purging drops them, and that is kempo's decision to make, not this script's.

  What this does is say what is at stake, because there is no undo. Submissions are what visitors sent, and may be the only
  copy.
*/
export default async () => {
  try {
    const [forms] = await db.select({ count: sql`count(*)::int` }).from(kempoFormsForm);
    const [submissions] = await db.select({ count: sql`count(*)::int` }).from(kempoFormsSubmission);
    console.log(`[kempo-forms] Removing. ${forms?.count || 0} form${forms?.count === 1 ? '' : 's'} and ${submissions?.count || 0} submission${submissions?.count === 1 ? '' : 's'} are kept in the database.`);
    if(submissions?.count){
      console.warn('[kempo-forms] Purging the data deletes every submission — export them first if you need them.');
    }
  } catch {
    // The tables may already be gone; there is nothing to report on.
  }
};
