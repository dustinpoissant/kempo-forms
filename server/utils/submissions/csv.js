import { desc } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsSubmission } from '../../db/schema.js';
import { filtersFor } from './read.js';
import { displayText } from './present.js';

/*
  A CSV of the submissions that match the admin's filters: when, which form and what status, then one column per field. Fields
  are matched across forms by key, so two forms that both ask for `email` share a column. An erased answer is left empty.

  A spreadsheet runs a cell that starts with = + - or @ as a formula, and the cells here are whatever visitors typed, so those
  cells are prefixed with an apostrophe.
*/

const LIMIT = 10000;

const cell = value => {
  let text = String(value ?? '');
  if(/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const rowsToCsv = rows => {
  const columns = new Map();
  for(const row of rows) for(const field of row.schema) if(!columns.has(field.key)) columns.set(field.key, field.label);

  const lines = [['Submitted', 'Form', 'Status', ...columns.values()].map(cell).join(',')];
  for(const row of rows){
    const byKey = new Map(row.schema.map(field => [field.key, field]));
    lines.push([
      row.createdAt.toISOString(),
      row.formTitle,
      row.status,
      ...[...columns.keys()].map(key => byKey.has(key) && row.values[key] !== undefined ? displayText(byKey.get(key), row.values[key]) : ''),
    ].map(cell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
};

export default async filters => rowsToCsv(await db.select().from(kempoFormsSubmission).where(filtersFor(filters)).orderBy(desc(kempoFormsSubmission.createdAt)).limit(LIMIT));
