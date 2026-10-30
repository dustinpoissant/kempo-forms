import { createIndexes, ensureColumns } from './server/db/indexes.js';

/*
  Updating makes sure the columns and indexes exist. Every statement is `IF NOT EXISTS`, so this is safe from any version to any
  other. kempo's declarative diff adds new settings, permissions and groups and never overwrites a value.
*/
export default async () => {
  await ensureColumns();
  await createIndexes();
};
