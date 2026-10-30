import { createIndexes, ensureColumns } from './server/db/indexes.js';

/*
  What kempo-config.json cannot say: the indexes. kempo's installer makes this extension's tables from the Drizzle schema with
  their columns and primary keys and nothing else, so the unique index on a form's slug is made here (server/db/indexes.js).
  If it cannot be made the install fails rather than going ahead without it.

  Nobody gets a group automatically: forms are managed by the people the site puts in the kempo-forms groups. Email
  notifications start off, and are turned on in the settings once an email extension (kempo-resend or kempo-smtp) is installed.
*/
export default async () => {
  await ensureColumns();
  await createIndexes();
  console.log([
    '[kempo-forms] Installed.',
    '  Put people in the kempo-forms groups to let them build forms and read submissions.',
    '  To email submissions, install an email extension (kempo-resend or kempo-smtp), then turn on Email notifications in the Forms settings.',
    '  Existing sites need `npx drizzle-kit push` to add the scheduledJob table if it is missing, or the sweep will not run.',
  ].join('\n'));
};
