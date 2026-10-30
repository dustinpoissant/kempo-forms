import { markdownToHtml, sanitizeRichHtml, htmlToText } from '../richtext.js';

/*
  How a stored value reads to a person: in an email (as safe HTML) and in an export (as text). Nothing here reaches the browser's
  DOM unescaped: text is escaped, and the two formatted types go through the sanitiser.
*/

export const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&#39;');

const optionLabel = (field, value) => (field.options || []).find(option => option.value === String(value))?.label ?? String(value);

/*
  A value as plain text. A file field holds file ids, which are shown as a count.
*/
export const displayText = (field, value) => {
  if(value === undefined || value === null || value === '') return '';
  switch(field.type){
    case 'checkbox':
    case 'toggle': return value ? 'Yes' : 'No';
    case 'rating': return `${value} of 5`;
    case 'select':
    case 'combobox':
    case 'radio':
    case 'segmented': return optionLabel(field, value);
    case 'checkboxes': return value.map(item => optionLabel(field, item)).join(', ');
    case 'tags': return value.join(', ');
    case 'daterange':
    case 'slider': return Array.isArray(value) ? value.join(' to ') : String(value);
    case 'richtext': return htmlToText(value);
    case 'file':
    case 'image': return `${value.length} file${value.length === 1 ? '' : 's'}`;
    default: return String(value);
  }
};

/*
  A value as HTML that is safe to put in an email or the admin.
*/
export const displayHtml = (field, value) => {
  if(field.type === 'markdown') return markdownToHtml(value);
  if(field.type === 'richtext') return sanitizeRichHtml(value);
  return escapeHtml(displayText(field, value)).replaceAll('\n', '<br>');
};

/*
  The rows of a submission, in the form's order, for the fields that were answered.
*/
export const rowsOf = (schema, values) => schema
  .filter(field => values[field.key] !== undefined && values[field.key] !== null)
  .map(field => ({ key: field.key, label: field.label, type: field.type, text: displayText(field, values[field.key]), html: displayHtml(field, values[field.key]) }));
