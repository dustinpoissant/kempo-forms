import { TYPES, isGiven } from '../fields/types.js';
import { matches } from '../fields/conditions.js';
import { compileFullMatch } from '../spam/regex.js';
import { checkFiles } from '../files/uploads.js';

/*
  Turns what a visitor sent into what is stored, and finds everything wrong with it, without touching the database.

  Fields are taken in form order. A field whose condition is not met (or depends on a field that is itself hidden) is skipped: its
  value is dropped, it is not validated and it is never required. That is decided here from the values received, not from what
  the browser says it showed.

  Returns { values, errors, visible }. `values` holds only the keys of visible fields that were answered; a checkbox or switch is
  always recorded, on or off, because an unticked consent box is itself a fact. `files` is { [key]: [{ name, size }] } for the
  file fields, whose contents are stored later.
*/

const PATTERN_TYPES = ['text', 'textarea', 'email', 'tel'];

export default ({ fields, input, files = {}, config }) => {
  const context = { maxLength: config.maxFieldLength };
  const values = {};
  const errors = {};
  const visible = new Set();

  for(const field of fields){
    const condition = field.showWhen;
    if(condition && !(visible.has(condition.key) && matches(condition, values))) continue;
    visible.add(field.key);

    const type = TYPES[field.type];

    if(type.files){
      const list = files[field.key] || [];
      const problem = checkFiles(field, list, config);
      if(problem) errors[field.key] = problem;
      else if(field.required && !list.length) errors[field.key] = 'This field is required.';
      continue;
    }

    const [message, value] = type.normalise(input?.[field.key], field, context);
    if(message){
      errors[field.key] = message;
      continue;
    }

    if(!isGiven(value)){
      if(field.required) errors[field.key] = 'This field is required.';
      else if(typeof value === 'boolean') values[field.key] = value;
      continue;
    }

    if(type.text && typeof value === 'string'){
      if(field.minLength && value.length < field.minLength){
        errors[field.key] = `Enter at least ${field.minLength} characters.`;
        continue;
      }
      if(field.maxLength && value.length > field.maxLength){
        errors[field.key] = `Enter at most ${field.maxLength} characters.`;
        continue;
      }
      if(field.pattern && PATTERN_TYPES.includes(field.type)){
        const [, regex] = compileFullMatch(field.pattern);
        if(regex && !regex.test(value)){
          errors[field.key] = 'That is not in the format asked for.';
          continue;
        }
      }
    }

    values[field.key] = value;
  }

  return { values, errors, visible };
};
