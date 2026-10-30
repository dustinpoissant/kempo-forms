import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';

/*
  kempo-files fires this before every download. A file a form stored is named `<submission id>-<name>`, and while that
  submission is in the Trash its files cannot be opened: the Trash is meant to put a submission out of reach until it is restored
  or emptied. Anything that is not one of ours is let through untouched, with no query.
*/
const OURS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;

export default async ({ file }) => {
  const match = OURS.exec(file?.name ?? '');
  if(!match) return;

  const submissionId = match[0].slice(0, 36);
  const rows = await db.execute(sql`SELECT 1 FROM "kempoFormsSubmission" WHERE "id" = ${submissionId} AND "status" = 'trashed' LIMIT 1`);
  if(rows.length || rows.rows?.length) throw { code: 404, msg: 'This file is not available' };
};
