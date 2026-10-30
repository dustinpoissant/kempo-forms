import { compileRegex, MAX_PATTERN } from './regex.js';
import { htmlToText, markdownToText } from '../richtext.js';

/*
  Regex spam rules. A rule is { name, pattern, flags, fields }: `fields` is 'all' or a list of field keys, `flags` is any of i and
  m. The same shape is used by the site-wide list in the settings and by each form's own list. What a matching rule does is not
  part of the rule: it is the `spam_action` setting at the time (keep it as spam, or refuse it).

  The patterns run on RE2 (see regex.js), so a rule can never hang the server however it is written.
*/

const MAX_RULES = 50;

export const validateRules = (rules, label = 'The spam rules') => {
  if(rules === undefined || rules === null) return [null, []];
  if(!Array.isArray(rules)) return [{ code: 400, msg: `${label} must be a list.` }, null];
  if(rules.length > MAX_RULES) return [{ code: 400, msg: `${label}: at most ${MAX_RULES} rules.` }, null];

  const clean = [];
  for(const [index, raw] of rules.entries()){
    if(!raw || typeof raw !== 'object') return [{ code: 400, msg: `${label}: rule ${index + 1} is not valid.` }, null];
    const pattern = typeof raw.pattern === 'string' ? raw.pattern : '';
    const flags = typeof raw.flags === 'string' ? [...new Set(raw.flags)].filter(flag => 'im'.includes(flag)).join('') : '';
    const name = (typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : pattern).slice(0, 100);
    const [error] = compileRegex(pattern, flags);
    if(error) return [{ code: 400, msg: `${label}: rule ${index + 1} (${name || 'blank'}): ${error.msg}` }, null];

    let fields = 'all';
    if(Array.isArray(raw.fields) && raw.fields.length) fields = raw.fields.map(String).slice(0, 100);
    clean.push({ name, pattern: pattern.slice(0, MAX_PATTERN), flags, fields });
  }
  return [null, clean];
};

/*
  What a value looks like to a rule: text, with markup removed from formatted fields, and a list's items joined by spaces.
*/
export const plainTextOf = (type, value) => {
  if(value === null || value === undefined) return '';
  if(type === 'markdown') return markdownToText(value);
  if(type === 'richtext') return htmlToText(value);
  if(Array.isArray(value)) return value.map(String).join(' ');
  return String(value);
};

/*
  Every rule that matches, as verdicts. The verdict names the rule and the field, never the text that matched: a record of why
  something was flagged must not hold what a visitor typed.
*/
export const runRules = ({ rules, fields, values, action }) => {
  const verdicts = [];
  for(const rule of rules){
    const [error, regex] = compileRegex(rule.pattern, rule.flags);
    if(error) continue;
    for(const field of fields){
      if(rule.fields !== 'all' && !rule.fields.includes(field.key)) continue;
      const value = plainTextOf(field.type, values[field.key]);
      if(value && regex.test(value)){
        verdicts.push({ source: 'regex', action, reason: `The rule "${rule.name}" matched the field "${field.label}"` });
        break;
      }
    }
    if(verdicts.some(verdict => verdict.action === 'reject')) break;
  }
  return verdicts;
};

/*
  The admin's tester: which rules match a sample of text. Nothing is saved.
*/
export const testRules = ({ rules, sample }) => {
  const [error, clean] = validateRules(rules);
  if(error) return [error, null];
  const text = String(sample ?? '').slice(0, 20000);
  const matched = [];
  for(const rule of clean){
    const [, regex] = compileRegex(rule.pattern, rule.flags);
    if(regex && regex.test(text)) matched.push({ name: rule.name });
  }
  return [null, { matched }];
};
