import { isEmail } from '../emails.js';
import { sanitizeRichHtml } from '../richtext.js';

/*
  Every field type: what it is stored as, and how a value that arrived from a visitor is turned into that stored form (or
  refused). Nothing the browser sends is trusted, whatever the input in the page would have allowed.

  A type is { label, input, choices, text, files, rich, normalise }:
    input     the element that renders it (a native input type, or a kempo-ui tag), for the public component and the editor
    choices   it needs `options` (a list of { value, label })
    text      its value is a string, so `minLength`, `maxLength` and `pattern` apply
    files     the value is files, stored in kempo-files; the pipeline handles them (server/utils/files/uploads.js)
    rich      the value is markdown or HTML, and only exists while the `rich_text` setting allows it
    normalise (raw, field, context) -> [message | null, stored value]; an empty answer is stored as null

  `context` is { maxLength }, the site's longest allowed field.
*/

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

const isDate = value => {
  if(!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const bare = value => value === undefined || value === null || value === '';

const text = (raw, { multiline = false } = {}) => {
  if(bare(raw)) return [null, null];
  if(typeof raw !== 'string') return ['Enter text.', null];
  const value = (multiline ? raw.replace(/\r\n?/g, '\n') : raw.replace(/\s+/g, ' ')).trim();
  return [null, value || null];
};

const tooLong = (value, context) => typeof value === 'string' && value.length > context.maxLength
  ? `That is longer than the ${context.maxLength} characters allowed.`
  : null;

const limits = field => ({
  min: Number.isFinite(field.settings?.min) ? field.settings.min : 0,
  max: Number.isFinite(field.settings?.max) ? field.settings.max : 100,
});

const choice = (raw, field) => {
  if(bare(raw)) return [null, null];
  const value = String(raw);
  return (field.options || []).some(option => option.value === value) ? [null, value] : ['Choose one of the options.', null];
};

const boolean = raw => [null, raw === true || raw === 'true' || raw === 'on' || raw === 1];

const list = raw => {
  if(bare(raw)) return [null, []];
  if(Array.isArray(raw)) return [null, raw];
  return typeof raw === 'string' ? [null, raw.split(',')] : ['Send a list.', null];
};

const numberOf = raw => {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const TYPES = {
  text: {
    label: 'Short text',
    input: 'text',
    text: true,
    normalise: (raw, field, context) => {
      const [error, value] = text(raw);
      return error ? [error, null] : [tooLong(value, context), value];
    },
  },
  textarea: {
    label: 'Long text',
    input: 'textarea',
    text: true,
    normalise: (raw, field, context) => {
      const [error, value] = text(raw, { multiline: true });
      return error ? [error, null] : [tooLong(value, context), value];
    },
  },
  email: {
    label: 'Email address',
    input: 'email',
    text: true,
    normalise: (raw, field, context) => {
      const [error, value] = text(raw);
      if(error) return [error, null];
      if(value && !isEmail(value)) return ['Enter a valid email address.', null];
      return [tooLong(value, context), value];
    },
  },
  tel: {
    label: 'Phone number',
    input: 'tel',
    text: true,
    normalise: (raw, field, context) => {
      const [error, value] = text(raw);
      if(error) return [error, null];
      if(value && !/^[0-9+()\-.\s#*x]{3,40}$/i.test(value)) return ['Enter a valid phone number.', null];
      return [tooLong(value, context), value];
    },
  },
  number: {
    label: 'Number',
    input: 'number',
    normalise: (raw, field) => {
      if(bare(raw)) return [null, null];
      const value = numberOf(raw);
      if(value === null) return ['Enter a number.', null];
      const { min, max } = field.settings || {};
      if(Number.isFinite(min) && value < min) return [`Enter ${min} or more.`, null];
      if(Number.isFinite(max) && value > max) return [`Enter ${max} or less.`, null];
      return [null, value];
    },
  },
  select: { label: 'Dropdown', input: 'select', choices: true, normalise: choice },
  combobox: { label: 'Searchable dropdown', input: 'k-combobox', choices: true, normalise: choice },
  radio: { label: 'Choose one', input: 'radio', choices: true, normalise: choice },
  segmented: { label: 'Segmented choice', input: 'k-segmented-control', choices: true, normalise: choice },
  checkbox: { label: 'Checkbox', input: 'checkbox', normalise: boolean },
  toggle: { label: 'Yes / no switch', input: 'k-toggle', normalise: boolean },
  checkboxes: {
    label: 'Choose several',
    input: 'checkboxes',
    choices: true,
    normalise: (raw, field) => {
      const [error, items] = list(raw);
      if(error) return [error, null];
      const values = [...new Set(items.map(String))];
      if(values.some(value => !(field.options || []).some(option => option.value === value))) return ['Choose from the options.', null];
      if(Number.isFinite(field.settings?.maxItems) && values.length > field.settings.maxItems) return [`Choose at most ${field.settings.maxItems}.`, null];
      return [null, values];
    },
  },
  tags: {
    label: 'Tags',
    input: 'k-tags',
    normalise: (raw, field, context) => {
      const [error, items] = list(raw);
      if(error) return [error, null];
      const values = [...new Set(items.map(item => String(item).trim()).filter(Boolean))];
      if(values.some(value => value.length > Math.min(100, context.maxLength))) return ['A tag is too long.', null];
      const max = Number.isFinite(field.settings?.maxItems) ? field.settings.maxItems : 20;
      if(values.length > max) return [`Enter at most ${max}.`, null];
      if(field.settings?.onlySuggestions && values.some(value => !(field.options || []).some(option => option.value === value))) {
        return ['Choose from the suggestions.', null];
      }
      return [null, values];
    },
  },
  date: {
    label: 'Date',
    input: 'k-calendar',
    normalise: (raw, field) => {
      if(bare(raw)) return [null, null];
      if(typeof raw !== 'string' || !isDate(raw)) return ['Enter a valid date.', null];
      const { min, max } = field.settings || {};
      if(typeof min === 'string' && raw < min) return [`Choose ${min} or later.`, null];
      if(typeof max === 'string' && raw > max) return [`Choose ${max} or earlier.`, null];
      return [null, raw];
    },
  },
  daterange: {
    label: 'Date range',
    input: 'k-calendar',
    normalise: raw => {
      if(bare(raw) || (Array.isArray(raw) && !raw.length)) return [null, null];
      const [start, end] = Array.isArray(raw) ? raw : String(raw).split(',');
      if(!isDate(String(start)) || !isDate(String(end))) return ['Choose a start and an end date.', null];
      if(start > end) return ['The end cannot be before the start.', null];
      return [null, [start, end]];
    },
  },
  time: {
    label: 'Time',
    input: 'k-time',
    normalise: raw => {
      if(bare(raw)) return [null, null];
      return typeof raw === 'string' && TIME.test(raw) ? [null, raw] : ['Enter a valid time.', null];
    },
  },
  rating: {
    label: 'Star rating',
    input: 'k-rating',
    normalise: raw => {
      if(bare(raw) || raw === 0 || raw === '0') return [null, null];
      const value = numberOf(raw);
      return Number.isInteger(value) && value >= 1 && value <= 5 ? [null, value] : ['Choose from 1 to 5 stars.', null];
    },
  },
  slider: {
    label: 'Slider',
    input: 'k-slider',
    normalise: (raw, field) => {
      if(bare(raw) || (Array.isArray(raw) && !raw.length)) return [null, null];
      const { min, max } = limits(field);
      const inRange = value => value !== null && value >= min && value <= max;
      if(field.settings?.range){
        const [low, high] = (Array.isArray(raw) ? raw : String(raw).split(',')).map(numberOf);
        if(!inRange(low) || !inRange(high) || low > high) return [`Choose a range from ${min} to ${max}.`, null];
        return [null, [low, high]];
      }
      const value = numberOf(Array.isArray(raw) ? raw[0] : raw);
      return inRange(value) ? [null, value] : [`Choose a value from ${min} to ${max}.`, null];
    },
  },
  color: {
    label: 'Colour',
    input: 'k-color-picker',
    normalise: (raw, field) => {
      if(bare(raw)) return [null, null];
      if(typeof raw !== 'string' || !COLOR.test(raw)) return ['Choose a colour.', null];
      if(raw.length === 9 && !field.settings?.allowAlpha) return ['Choose a colour without transparency.', null];
      return [null, raw.toLowerCase()];
    },
  },
  markdown: {
    label: 'Formatted text (markdown)',
    input: 'k-markdown-editor',
    text: true,
    rich: true,
    normalise: (raw, field, context) => {
      const [error, value] = text(raw, { multiline: true });
      return error ? [error, null] : [tooLong(value, context), value];
    },
  },
  richtext: {
    label: 'Formatted text (rich text)',
    input: 'k-html-editor',
    rich: true,
    normalise: (raw, field, context) => {
      if(bare(raw)) return [null, null];
      if(typeof raw !== 'string') return ['Enter text.', null];
      const tooBig = tooLong(raw, { maxLength: context.maxLength * 4 });
      if(tooBig) return [tooBig, null];
      const cleaned = sanitizeRichHtml(raw).trim();
      return [null, cleaned || null];
    },
  },
  file: { label: 'File upload', input: 'file', files: true, normalise: () => [null, null] },
  image: { label: 'Image upload', input: 'k-image-crop', files: true, normalise: () => [null, null] },
};

export const TYPE_NAMES = Object.keys(TYPES);

/*
  Whether an answer counts as given. A single checkbox or switch counts only when it is on, which is what "required" means for
  a consent box.
*/
export const isGiven = value => {
  if(value === undefined || value === null || value === '' || value === false) return false;
  return !(Array.isArray(value) && !value.length);
};

/*
  The fields a form actually has right now: rich text fields only while the setting allows that kind, and file fields only while
  kempo-files is installed. A field that is not there is not rendered, not validated and not required, so turning a feature off
  never leaves a form that cannot be submitted.
*/
export const effectiveFields = (fields, { richText = 'markdown', filesAvailable = false } = {}) => fields.filter(field => {
  const type = TYPES[field.type];
  if(!type) return false;
  if(type.files) return filesAvailable;
  if(field.type === 'markdown') return richText === 'markdown' || richText === 'html';
  if(field.type === 'richtext') return richText === 'html';
  return true;
});
