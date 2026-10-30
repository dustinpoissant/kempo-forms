import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateFields } from '../server/utils/fields/definition.js';
import { TYPES, effectiveFields } from '../server/utils/fields/types.js';
import { matches, visibleKeys } from '../server/utils/fields/conditions.js';
import { visibleKeys as browserVisibleKeys, matches as browserMatches } from '../public/utils/conditions.js';
import normalise from '../server/utils/submissions/normalise.js';
import { compileFullMatch, compileRegex } from '../server/utils/spam/regex.js';

/*
  Field definitions, the value of every field type, and conditional fields: what is accepted, what is refused, what is stored.
  These are pure, so they need no database.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = { maxFieldLength: 100, uploadMaxBytes: 1000, uploadMaxFiles: 3 };

const field = (type, extra = {}) => ({ key: 'x', label: 'X', type, ...extra });

const normalised = (definition, raw) => {
  const [message, value] = TYPES[definition.type].normalise(raw, definition, { maxLength: CONFIG.maxFieldLength });
  return { message, value };
};

const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);

export default {
  'the browser copy of the condition evaluator is byte for byte the server one': async ({ pass, fail }) => {
    const server = await readFile(path.join(root, 'server/utils/fields/conditions.js'), 'utf8');
    const browser = await readFile(path.join(root, 'public/utils/conditions.js'), 'utf8');
    if(server !== browser) return fail('public/utils/conditions.js differs from server/utils/fields/conditions.js: copy the server file over it');
    pass('');
  },

  'conditions: every operator': async ({ pass, fail }) => {
    const cases = [
      [{ key: 'a', operator: 'equals', value: 'phone' }, { a: 'phone' }, true],
      [{ key: 'a', operator: 'equals', value: 'phone' }, { a: 'email' }, false],
      [{ key: 'a', operator: 'equals', value: 'phone' }, {}, false],
      [{ key: 'a', operator: 'not-equals', value: 'phone' }, { a: 'email' }, true],
      [{ key: 'a', operator: 'not-equals', value: 'phone' }, {}, true],
      [{ key: 'a', operator: 'includes', value: 'x' }, { a: ['x', 'y'] }, true],
      [{ key: 'a', operator: 'includes', value: 'z' }, { a: ['x', 'y'] }, false],
      [{ key: 'a', operator: 'checked' }, { a: true }, true],
      [{ key: 'a', operator: 'checked' }, { a: false }, false],
      [{ key: 'a', operator: 'not-checked' }, {}, true],
      [{ key: 'a', operator: 'empty' }, { a: '' }, true],
      [{ key: 'a', operator: 'empty' }, { a: [] }, true],
      [{ key: 'a', operator: 'not-empty' }, { a: 'z' }, true],
      [{ key: 'a', operator: 'nonsense' }, { a: 'z' }, false],
    ];
    for(const [condition, values, expected] of cases){
      if(matches(condition, values) !== expected) return fail(`${JSON.stringify(condition)} on ${JSON.stringify(values)} should be ${expected}`);
      if(browserMatches(condition, values) !== expected) return fail('the browser copy disagrees');
    }
    pass(`${cases.length} cases`);
  },

  'conditions: a field is hidden when its source is hidden, so chains resolve in order': async ({ pass, fail }) => {
    const fields = [
      { key: 'method', type: 'radio' },
      { key: 'phone', type: 'tel', showWhen: { key: 'method', operator: 'equals', value: 'phone' } },
      { key: 'ext', type: 'text', showWhen: { key: 'phone', operator: 'not-empty' } },
    ];
    if(!same([...visibleKeys(fields, { method: 'email', phone: '555', ext: '1' })], ['method'])) return fail('with email chosen, phone and ext must both be hidden');
    if(!same([...visibleKeys(fields, { method: 'phone', phone: '555' })], ['method', 'phone', 'ext'])) return fail('with phone chosen and filled, all three show');
    if(!same([...browserVisibleKeys(fields, { method: 'phone' })], ['method', 'phone'])) return fail('the browser copy disagrees');
    pass('');
  },

  'definition: a good field list is cleaned to exactly what is stored': async ({ pass, fail }) => {
    const [error, fields] = validateFields([
      { key: 'name', label: ' Name ', type: 'text', required: true, extra: 'ignored', minLength: 2, maxLength: 50 },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'plan', label: 'Plan', type: 'select', options: ['Free', { value: 'pro', label: 'Pro' }] },
    ], { filesAvailable: false });
    if(error) return fail(error.msg);
    if(fields[0].label !== 'Name' || 'extra' in fields[0]) return fail('the label is trimmed and unknown properties are dropped');
    if(fields[0].minLength !== 2 || fields[0].maxLength !== 50) return fail('lengths are kept');
    if(fields[1].personal !== true) return fail('an email field is personal unless said otherwise');
    if(fields[0].personal !== false) return fail('a text field is not personal unless said otherwise');
    if(!same(fields[2].options, [{ value: 'Free', label: 'Free' }, { value: 'pro', label: 'Pro' }])) return fail('options are normalised to value and label');
    pass('');
  },

  'definition: what is refused, and why': async ({ pass, fail }) => {
    const refuses = (fields, includes, options) => {
      const [error] = validateFields(fields, options);
      return error && error.msg.includes(includes) ? null : `expected "${includes}", got ${error ? `"${error.msg}"` : 'no error'}`;
    };
    const checks = [
      [[], 'at least one field'],
      [[{ key: 'Bad Key', label: 'A', type: 'text' }], 'key must start'],
      [[{ key: 'a', label: 'A', type: 'text' }, { key: 'a', label: 'B', type: 'text' }], 'used twice'],
      [[{ key: 'a', label: '', type: 'text' }], 'needs a label'],
      [[{ key: 'a', label: 'A', type: 'nope' }], 'not a field type'],
      [[{ key: 'a', label: 'A', type: 'select' }], 'add at least one option'],
      [[{ key: 'a', label: 'A', type: 'select', options: ['x', 'x'] }], 'twice'],
      [[{ key: 'a', label: 'A', type: 'text', pattern: '(a)\\1' }], 'cannot be used'],
      [[{ key: 'a', label: 'A', type: 'text', pattern: '(?=a)a' }], 'cannot be used'],
      [[{ key: 'a', label: 'A', type: 'text', minLength: 5, maxLength: 2 }], 'longer than the longest'],
      [[{ key: 'a', label: 'A', type: 'text', showWhen: { key: 'a', operator: 'empty' } }], 'field above it'],
      [[{ key: 'a', label: 'A', type: 'text' }, { key: 'b', label: 'B', type: 'text', showWhen: { key: 'c', operator: 'empty' } }], 'field above it'],
      [[{ key: 'a', label: 'A', type: 'text' }, { key: 'b', label: 'B', type: 'text', showWhen: { key: 'a', operator: 'checked' } }], 'only use ticked'],
      [[{ key: 'a', label: 'A', type: 'select', options: ['x'] }, { key: 'b', label: 'B', type: 'text', showWhen: { key: 'a', operator: 'equals', value: 'y' } }], 'not one of that field'],
      [[{ key: 'a', label: 'A', type: 'file' }], 'need kempo-files', { filesAvailable: false }],
    ];
    for(const [fields, includes, options] of checks){
      const problem = refuses(fields, includes, options);
      if(problem) return fail(problem);
    }
    pass(`${checks.length} refusals`);
  },

  'definition: a condition may follow an earlier field, including a checkbox': async ({ pass, fail }) => {
    const [error, fields] = validateFields([
      { key: 'phone_me', label: 'Phone me', type: 'checkbox' },
      { key: 'phone', label: 'Phone', type: 'tel', showWhen: { key: 'phone_me', operator: 'checked' } },
      { key: 'how', label: 'How', type: 'radio', options: ['phone', 'email'] },
      { key: 'number', label: 'Number', type: 'tel', showWhen: { key: 'how', operator: 'equals', value: 'phone' } },
    ]);
    if(error) return fail(error.msg);
    if(fields[1].showWhen.operator !== 'checked' || fields[3].showWhen.value !== 'phone') return fail('conditions are kept');
    pass('');
  },

  'types: text is trimmed, collapsed to one line, and bounded by the site length': async ({ pass, fail }) => {
    if(normalised(field('text'), '  Ada  \n Lovelace ').value !== 'Ada Lovelace') return fail(`got ${normalised(field('text'), '  Ada  \n Lovelace ').value}`);
    if(normalised(field('text'), '   ').value !== null) return fail('blank is empty');
    if(!normalised(field('text'), 'x'.repeat(101)).message) return fail('over the site length is refused');
    if(!normalised(field('text'), { a: 1 }).message) return fail('an object is refused');
    if(normalised(field('textarea'), 'a\r\nb').value !== 'a\nb') return fail('a textarea keeps its line breaks');
    pass('');
  },

  'types: email, phone and number': async ({ pass, fail }) => {
    if(!normalised(field('email'), 'nope').message) return fail('a bad email is refused');
    if(normalised(field('email'), ' Ada@Example.com ').value !== 'Ada@Example.com') return fail('a good email is trimmed');
    if(!normalised(field('tel'), 'call me').message) return fail('a bad phone is refused');
    if(normalised(field('tel'), '+1 (555) 123-4567').value !== '+1 (555) 123-4567') return fail('a phone keeps its formatting');
    if(normalised(field('number'), '42').value !== 42) return fail('a numeric string becomes a number');
    if(!normalised(field('number'), 'abc').message) return fail('not a number is refused');
    if(!normalised(field('number', { settings: { max: 10 } }), 11).message) return fail('over the max is refused');
    if(!normalised(field('number', { settings: { min: 5 } }), 4).message) return fail('under the min is refused');
    pass('');
  },

  'types: a choice must be one of the options': async ({ pass, fail }) => {
    const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    for(const type of ['select', 'radio', 'combobox', 'segmented']){
      if(normalised(field(type, { options }), 'a').value !== 'a') return fail(`${type}: a real option is kept`);
      if(!normalised(field(type, { options }), 'z').message) return fail(`${type}: an unknown value is refused`);
    }
    if(!same(normalised(field('checkboxes', { options }), ['a', 'b', 'a']).value, ['a', 'b'])) return fail('checkboxes dedupe');
    if(!normalised(field('checkboxes', { options }), ['a', 'z']).message) return fail('checkboxes refuse an unknown option');
    if(!normalised(field('checkboxes', { options, settings: { maxItems: 1 } }), ['a', 'b']).message) return fail('checkboxes respect maxItems');
    pass('');
  },

  'types: booleans, dates, times': async ({ pass, fail }) => {
    for(const [raw, expected] of [[true, true], ['true', true], ['on', true], [false, false], [undefined, false], ['no', false]]){
      if(normalised(field('checkbox'), raw).value !== expected) return fail(`checkbox ${JSON.stringify(raw)} should be ${expected}`);
    }
    if(normalised(field('date'), '2026-02-28').value !== '2026-02-28') return fail('a real date is kept');
    if(!normalised(field('date'), '2026-02-30').message) return fail('a date that does not exist is refused');
    if(!normalised(field('date'), '28/02/2026').message) return fail('a date in the wrong shape is refused');
    if(!normalised(field('date', { settings: { min: '2026-03-01' } }), '2026-02-28').message) return fail('before min is refused');
    if(!same(normalised(field('daterange'), '2026-01-01,2026-01-05').value, ['2026-01-01', '2026-01-05'])) return fail('a range arrives as two dates');
    if(!normalised(field('daterange'), ['2026-01-05', '2026-01-01']).message) return fail('an end before the start is refused');
    if(normalised(field('time'), '09:30').value !== '09:30') return fail('a time is kept');
    if(!normalised(field('time'), '24:00').message) return fail('an impossible time is refused');
    pass('');
  },

  'types: rating, slider, colour, tags': async ({ pass, fail }) => {
    if(normalised(field('rating'), '4').value !== 4) return fail('a rating of 4');
    if(normalised(field('rating'), 0).value !== null) return fail('0 stars is no rating');
    if(!normalised(field('rating'), 6).message) return fail('6 stars is refused');
    if(!normalised(field('rating'), 2.5).message) return fail('half a star is refused');
    if(normalised(field('slider', { settings: { min: 0, max: 10 } }), '7').value !== 7) return fail('a slider value');
    if(!normalised(field('slider', { settings: { min: 0, max: 10 } }), 11).message) return fail('a slider out of range is refused');
    if(!same(normalised(field('slider', { settings: { min: 0, max: 10, range: true } }), '2,8').value, [2, 8])) return fail('a slider range is two numbers');
    if(!normalised(field('slider', { settings: { min: 0, max: 10, range: true } }), [8, 2]).message) return fail('a reversed range is refused');
    if(normalised(field('color'), '#FF8800').value !== '#ff8800') return fail('a colour is lowercased');
    if(!normalised(field('color'), '#ff880080').message) return fail('transparency is refused unless allowed');
    if(normalised(field('color', { settings: { allowAlpha: true } }), '#ff880080').message) return fail('transparency is accepted when allowed');
    if(!normalised(field('color'), 'red').message) return fail('a colour name is refused');
    if(!same(normalised(field('tags'), ['a', ' b ', 'a', '']).value, ['a', 'b'])) return fail('tags are trimmed and deduped');
    if(!normalised(field('tags', { settings: { maxItems: 2 } }), ['a', 'b', 'c']).message) return fail('too many tags are refused');
    if(!normalised(field('tags', { options: [{ value: 'a', label: 'a' }], settings: { onlySuggestions: true } }), ['z']).message) return fail('only the suggestions are accepted');
    pass('');
  },

  'types: markdown is kept as typed and rich text is cleaned before it is stored': async ({ pass, fail }) => {
    if(normalised(field('markdown'), '**hi**').value !== '**hi**') return fail('markdown is stored raw');
    const dirty = '<p onclick="x()">Hi <script>alert(1)</script><a href="javascript:alert(1)">a</a><img src=x onerror=alert(1)></p>';
    const { value } = normalised(field('richtext'), dirty);
    if(/script|onclick|onerror|javascript:/i.test(value)) return fail(`rich text still holds something unsafe: ${value}`);
    if(!value.includes('Hi')) return fail('the words survive');
    pass('');
  },

  'effective fields drop what the settings or the install cannot support': async ({ pass, fail }) => {
    const fields = [{ key: 'a', type: 'text' }, { key: 'b', type: 'markdown' }, { key: 'c', type: 'richtext' }, { key: 'd', type: 'file' }, { key: 'e', type: 'unknown' }];
    const keys = options => effectiveFields(fields, options).map(entry => entry.key).join('');
    if(keys({ richText: 'off', filesAvailable: false }) !== 'a') return fail('with rich text off and no kempo-files only text remains');
    if(keys({ richText: 'markdown', filesAvailable: false }) !== 'ab') return fail('markdown mode keeps markdown fields');
    if(keys({ richText: 'html', filesAvailable: true }) !== 'abcd') return fail('html mode keeps rich text, and kempo-files keeps file fields');
    pass('');
  },

  'normalise: a hidden field is dropped, never validated, and never required': async ({ pass, fail }) => {
    const fields = [
      { key: 'how', label: 'How', type: 'radio', options: [{ value: 'phone', label: 'Phone' }, { value: 'email', label: 'Email' }] },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, showWhen: { key: 'how', operator: 'equals', value: 'phone' } },
      { key: 'address', label: 'Email', type: 'email', required: true, showWhen: { key: 'how', operator: 'equals', value: 'email' } },
    ];
    const email = normalise({ fields, input: { how: 'email', address: 'a@b.co', phone: 'not a phone but it is hidden' }, config: CONFIG });
    if(Object.keys(email.errors).length) return fail(`unexpected errors ${JSON.stringify(email.errors)}`);
    if(!same(email.values, { how: 'email', address: 'a@b.co' })) return fail(`a value sent for a hidden field must be dropped: ${JSON.stringify(email.values)}`);

    const phone = normalise({ fields, input: { how: 'phone' }, config: CONFIG });
    if(!phone.errors.phone || phone.errors.address) return fail(`only the visible required field is required: ${JSON.stringify(phone.errors)}`);
    pass('');
  },

  'normalise: required, lengths and patterns': async ({ pass, fail }) => {
    const fields = [
      { key: 'code', label: 'Code', type: 'text', required: true, minLength: 3, maxLength: 5, pattern: '[A-Z]+' },
      { key: 'agree', label: 'Agree', type: 'checkbox', required: true },
      { key: 'news', label: 'News', type: 'checkbox' },
    ];
    const run = input => normalise({ fields, input, config: CONFIG });
    if(!run({}).errors.code || !run({}).errors.agree) return fail('required fields are required, and an unticked required box counts as missing');
    if(!run({ code: 'AB', agree: true }).errors.code) return fail('under the minimum length');
    if(!run({ code: 'ABCDEF', agree: true }).errors.code) return fail('over the maximum length');
    if(!run({ code: 'abc', agree: true }).errors.code) return fail('not matching the pattern');
    const good = run({ code: 'ABC', agree: true });
    if(Object.keys(good.errors).length) return fail(`unexpected ${JSON.stringify(good.errors)}`);
    if(good.values.news !== false) return fail('an unticked optional checkbox is recorded as off');
    pass('');
  },

  'regex: backreferences and lookaround are refused, and a catastrophic pattern is harmless': async ({ pass, fail }) => {
    if(!compileRegex('(a)\\1')[0]) return fail('a backreference must be refused');
    if(!compileRegex('(?<=a)b')[0]) return fail('lookbehind must be refused');
    if(!compileRegex('x'.repeat(501))[0]) return fail('a pattern over 500 characters must be refused');
    if(!compileRegex('a', 'g')[0]) return fail('only the i and m flags are allowed');
    const [, regex] = compileRegex('^(a+)+$');
    const started = Date.now();
    regex.test(`${'a'.repeat(50000)}b`);
    if(Date.now() - started > 1000) return fail('RE2 should be linear: a nested quantifier took over a second');
    const [, whole] = compileFullMatch('[a-z]+');
    if(!whole.test('abc') || whole.test('abc1')) return fail('a field pattern must match the whole value');
    pass('');
  },
};
