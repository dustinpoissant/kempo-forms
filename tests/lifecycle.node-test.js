import { sql } from 'drizzle-orm';
import install from '../install.js';
import update from '../update.js';
import uninstall from '../uninstall.js';
import { INDEXES } from '../server/db/indexes.js';
import { createForm } from '../server/utils/forms/save.js';
import { db, seedDatabase } from './helpers/db.js';
import { FIELDS, makeForm, purge } from './helpers/forms.js';

/*
  What kempo runs when this extension is installed, updated and removed.

  The test database already has every index — drizzle-kit made them from the schema — which is exactly why a mistake in
  install.js would never show. So they are dropped first, and install.js has to put them back. The unique one is then proved to
  work by trying to break it.
*/

const existingIndexes = async () => {
  const rows = await db.execute(sql`select indexname from pg_indexes where tablename like 'kempoForms%'`);
  return new Set(rows.map(row => row.indexname));
};

const dropIndexes = async () => {
  for(const { name } of INDEXES) await db.execute(sql.raw(`DROP INDEX IF EXISTS "${name}"`));
};

const quietly = async run => {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try {
    return await run();
  } finally {
    console.log = log;
    console.warn = warn;
  }
};

export const beforeAll = async () => {
  await seedDatabase();
  await purge();
};

export const afterAll = async () => {
  await quietly(install);
  await purge();
};

export default {
  'install creates every index, and the unique address holds': async ({ pass, fail }) => {
    await dropIndexes();
    const before = await existingIndexes();
    if(INDEXES.some(({ name }) => before.has(name))) return fail('the indexes were not dropped, so this proves nothing');

    await quietly(install);
    const after = await existingIndexes();
    const missing = INDEXES.filter(({ name }) => !after.has(name)).map(({ name }) => name);
    if(missing.length) return fail(`install did not create: ${missing.join(', ')}`);

    await makeForm({ slug: 'unique-one' });
    const [error] = await createForm({ input: { title: 'Again', slug: 'unique-one', fields: FIELDS } });
    if(error?.code !== 409) return fail('two forms must not share an address');
    pass(`${INDEXES.length} indexes`);
  },

  'update is safe to run again and again, and puts back a missing index': async ({ pass, fail }) => {
    await db.execute(sql`DROP INDEX IF EXISTS "kempoFormsSubmission_status_idx"`);
    await quietly(update);
    await quietly(update);
    if(!(await existingIndexes()).has('kempoFormsSubmission_status_idx')) return fail('update did not restore the index');
    pass('');
  },

  'install says what to do next': async ({ pass, fail }) => {
    const lines = [];
    const { log } = console;
    console.log = line => lines.push(line);
    try {
      await install();
    } finally {
      console.log = log;
    }
    const text = lines.join('\n');
    if(!text.includes('kempo-forms groups') || !text.includes('email extension')) return fail(`the install note is missing guidance: ${text}`);
    pass('');
  },

  'uninstall reports what is kept and deletes nothing': async ({ pass, fail }) => {
    await purge();
    await makeForm();
    const lines = [];
    const { log, warn } = console;
    console.log = line => lines.push(line);
    console.warn = line => lines.push(line);
    try {
      await uninstall();
    } finally {
      console.log = log;
      console.warn = warn;
    }
    if(!lines.join('\n').includes('1 form')) return fail(`it should count what is kept: ${lines.join(' | ')}`);
    const [{ count }] = await db.execute(sql`select count(*)::int as count from "kempoFormsForm"`);
    if(count !== 1) return fail('the form must still be there');
    pass('');
  },
};
