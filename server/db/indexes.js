import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';

/*
  The indexes server/db/schema.js declares, created by hand — kempo's installer makes columns and primary keys from a Drizzle
  schema and nothing else. install.js and update.js both run this, and a static test checks the list against the schema.

  The unique index on a form's slug is a correctness guarantee rather than speed: it is what keeps two forms from sharing an
  address. Failing to make it throws, which fails the install. Failing to make any of the others is a warning.
*/
export const INDEXES = [
  { name: 'kempoFormsForm_slug_idx', required: true, sql: sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoFormsForm_slug_idx" ON "kempoFormsForm" ("slug")` },
  { name: 'kempoFormsForm_status_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsForm_status_idx" ON "kempoFormsForm" ("status")` },
  { name: 'kempoFormsSubmission_form_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsSubmission_form_idx" ON "kempoFormsSubmission" ("formId", "createdAt")` },
  { name: 'kempoFormsSubmission_status_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsSubmission_status_idx" ON "kempoFormsSubmission" ("status", "createdAt")` },
  { name: 'kempoFormsSubmission_created_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsSubmission_created_idx" ON "kempoFormsSubmission" ("createdAt")` },
  { name: 'kempoFormsSubmission_user_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsSubmission_user_idx" ON "kempoFormsSubmission" ("userId")` },
  { name: 'kempoFormsSubmissionEvent_submission_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsSubmissionEvent_submission_idx" ON "kempoFormsSubmissionEvent" ("submissionId", "at")` },
  { name: 'kempoFormsAttempt_ip_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsAttempt_ip_idx" ON "kempoFormsAttempt" ("ipHash", "at")` },
  { name: 'kempoFormsAttempt_at_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsAttempt_at_idx" ON "kempoFormsAttempt" ("at")` },
  { name: 'kempoFormsErasure_status_idx', sql: sql`CREATE INDEX IF NOT EXISTS "kempoFormsErasure_status_idx" ON "kempoFormsErasure" ("status", "createdAt")` },
];

/*
  Columns added since a table was first created. kempo's installer makes a table from the schema only when it is missing, so a
  site whose table predates a column never gets it. Each statement is `IF NOT EXISTS`, so this is safe on every install and
  update, and a failure throws. Empty for now: nothing has been added since the first release.
*/
export const COLUMNS = [];

export const ensureColumns = async () => {
  for(const column of COLUMNS){
    try {
      await db.execute(column.sql);
    } catch(error) {
      throw new Error(`[kempo-forms] Could not add the column ${column.name}: ${error.message}`);
    }
  }
};

export const createIndexes = async () => {
  for(const index of INDEXES){
    try {
      await db.execute(index.sql);
    } catch(error) {
      if(index.required) throw new Error(`[kempo-forms] Could not create ${index.name}, which forms cannot work safely without: ${error.message}`);
      console.warn(`[kempo-forms] Could not create the index ${index.name}: ${error.message}`);
    }
  }
};
