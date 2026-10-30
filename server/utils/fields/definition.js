import { TYPES } from './types.js';
import { OPERATORS } from './conditions.js';
import { compileFullMatch } from '../spam/regex.js';

/*
  Checking and cleaning a form's list of field definitions when a form is saved. The result is exactly what is stored: only the
  properties below, each the right type, so nothing else a client sent ever reaches the database.

  A field is { key, label, type, required, placeholder, hint, options, pattern, minLength, maxLength, showWhen, personal,
  settings }. `key` is what a submission's value is stored under and never changes when the label does.
*/

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_FIELDS = 100;
const MAX_OPTIONS = 500;

/*
  The settings each type understands, and the type each must be. Anything else is dropped.
*/
const SETTINGS = {
  number: { min: 'number', max: 'number' },
  checkboxes: { maxItems: 'number' },
  tags: { maxItems: 'number', onlySuggestions: 'boolean' },
  date: { min: 'string', max: 'string', style: 'string' },
  slider: { min: 'number', max: 'number', step: 'number', range: 'boolean', format: 'string' },
  color: { allowAlpha: 'boolean' },
  time: { increment: 'number' },
  file: { accept: 'list', maxFiles: 'number' },
  image: { accept: 'list', aspectRatio: 'string' },
};

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

const whole = value => Number.isInteger(value) && value >= 0 ? value : null;

const cleanSettings = (type, raw) => {
  const allowed = SETTINGS[type];
  if(!allowed || !raw || typeof raw !== 'object') return {};
  const settings = {};
  for(const [name, kind] of Object.entries(allowed)){
    const value = raw[name];
    if(kind === 'number' && typeof value === 'number' && Number.isFinite(value)) settings[name] = value;
    else if(kind === 'boolean' && typeof value === 'boolean') settings[name] = value;
    else if(kind === 'string' && typeof value === 'string' && value.trim()) settings[name] = value.trim().slice(0, 100);
    else if(kind === 'list' && Array.isArray(value)){
      const items = [...new Set(value.map(item => String(item).trim().toLowerCase().replace(/^\./, '')).filter(item => /^[a-z0-9]{1,10}$/.test(item)))];
      if(items.length) settings[name] = items;
    }
  }
  return settings;
};

const cleanOptions = (raw, label) => {
  if(raw === undefined || raw === null) return [null, []];
  if(!Array.isArray(raw)) return [`${label}: the options must be a list.`, null];
  if(raw.length > MAX_OPTIONS) return [`${label}: at most ${MAX_OPTIONS} options.`, null];
  const options = [];
  for(const entry of raw){
    const value = text(typeof entry === 'object' && entry ? entry.value : entry, 200);
    const optionLabel = text(typeof entry === 'object' && entry ? entry.label : entry, 200) || value;
    if(!value) return [`${label}: an option has no value.`, null];
    if(options.some(option => option.value === value)) return [`${label}: "${value}" is in the options twice.`, null];
    options.push({ value, label: optionLabel });
  }
  return [null, options];
};

/*
  Whether a condition can be asked of the field it points at: "ticked" only means something for a checkbox, "includes" only for a
  list, and a choice field can only be compared with one of its own options.
*/
const checkCondition = (condition, source, label) => {
  const prefix = `${label}: "Show when"`;
  if(!condition || typeof condition !== 'object') return [`${prefix} is not valid.`, null];
  if(!OPERATORS.includes(condition.operator)) return [`${prefix} has an unknown comparison.`, null];

  const kind = TYPES[source.type];
  const toggle = source.type === 'checkbox' || source.type === 'toggle';
  const many = source.type === 'checkboxes' || source.type === 'tags';
  const op = condition.operator;
  if((op === 'checked' || op === 'not-checked') && !toggle) return [`${prefix} can only use ticked or not ticked with a checkbox or switch.`, null];
  if(toggle && !['checked', 'not-checked'].includes(op)) return [`${prefix} can only use ticked or not ticked when it depends on a checkbox or switch.`, null];
  if(op === 'includes' && !many) return [`${prefix} can only use "includes" with a list of choices.`, null];
  if((op === 'equals' || op === 'not-equals') && (many || kind.files)) return [`${prefix} cannot compare that field with a single value.`, null];

  const clean = { key: condition.key, operator: op };
  if(['equals', 'not-equals', 'includes'].includes(op)){
    const value = text(String(condition.value ?? ''), 200);
    if(!value) return [`${prefix} needs a value to compare with.`, null];
    if(kind.choices && !(source.options || []).some(option => option.value === value)) return [`${prefix} compares with "${value}", which is not one of that field's options.`, null];
    clean.value = value;
  }
  return [null, clean];
};

export const validateFields = (fields, { filesAvailable = true } = {}) => {
  if(!Array.isArray(fields)) return [{ code: 400, msg: 'The fields must be a list.' }, null];
  if(!fields.length) return [{ code: 400, msg: 'A form needs at least one field.' }, null];
  if(fields.length > MAX_FIELDS) return [{ code: 400, msg: `A form can have at most ${MAX_FIELDS} fields.` }, null];

  const clean = [];
  for(const raw of fields){
    if(!raw || typeof raw !== 'object') return [{ code: 400, msg: 'A field is not valid.' }, null];

    const key = text(raw.key, 40);
    const label = text(raw.label, 200);
    const name = label || key || 'A field';
    if(!KEY.test(key)) return [{ code: 400, msg: `${name}: the key must start with a letter and use only lowercase letters, numbers and underscores.` }, null];
    if(clean.some(field => field.key === key)) return [{ code: 400, msg: `${name}: the key "${key}" is used twice.` }, null];
    if(!label) return [{ code: 400, msg: `The field "${key}" needs a label.` }, null];

    const type = TYPES[raw.type];
    if(!type) return [{ code: 400, msg: `${name}: "${raw.type}" is not a field type.` }, null];
    if(type.files && !filesAvailable) return [{ code: 400, msg: `${name}: file fields need kempo-files, which is not installed.` }, null];

    const [optionsError, options] = cleanOptions(raw.options, name);
    if(optionsError) return [{ code: 400, msg: optionsError }, null];
    if(type.choices && !options.length) return [{ code: 400, msg: `${name}: add at least one option.` }, null];

    const field = {
      key,
      label,
      type: raw.type,
      required: raw.required === true,
      placeholder: text(raw.placeholder, 200),
      hint: text(raw.hint, 500),
      options: type.choices || raw.type === 'tags' ? options : [],
      personal: typeof raw.personal === 'boolean' ? raw.personal : ['email', 'tel'].includes(raw.type),
      settings: cleanSettings(raw.type, raw.settings),
    };

    if(type.text){
      const minLength = whole(raw.minLength);
      const maxLength = whole(raw.maxLength);
      if(minLength !== null) field.minLength = minLength;
      if(maxLength !== null) field.maxLength = maxLength;
      if(minLength !== null && maxLength !== null && minLength > maxLength) return [{ code: 400, msg: `${name}: the shortest length is longer than the longest.` }, null];
    }

    if(typeof raw.pattern === 'string' && raw.pattern && ['text', 'textarea', 'email', 'tel'].includes(raw.type)){
      const [patternError] = compileFullMatch(raw.pattern);
      if(patternError) return [{ code: 400, msg: `${name}: ${patternError.msg}` }, null];
      field.pattern = raw.pattern;
    }

    if(raw.showWhen){
      const source = clean.find(earlier => earlier.key === raw.showWhen.key);
      if(!source) return [{ code: 400, msg: `${name}: "Show when" must depend on a field above it.` }, null];
      const [conditionError, condition] = checkCondition(raw.showWhen, source, name);
      if(conditionError) return [{ code: 400, msg: conditionError }, null];
      field.showWhen = condition;
    }

    clean.push(field);
  }

  return [null, clean];
};
