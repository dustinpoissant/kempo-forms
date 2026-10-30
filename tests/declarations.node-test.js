import { readFile, readdir, stat } from 'fs/promises';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../server/db/schema.js';
import { INDEXES } from '../server/db/indexes.js';
import { DEFAULTS, NORMALISE, SETTING_NAMES } from '../server/utils/config/settings.js';
import { VALIDATORS } from '../server/utils/config/validate.js';
import { TYPES } from '../server/utils/fields/types.js';

/*
  Static checks that what the code asks for is what the extension declares.

  A permission checked by a route but never declared does not error — it answers "no", forever, for everyone but
  administrators, which is exactly why it survives testing by an administrator. A setting read but never declared silently uses
  its default. An index the schema declares but install.js forgets exists only on a developer's database, where `drizzle-kit
  push` made it. A route that cannot be imported answers 500 on the one request nobody tried. Each has a check here.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');
const config = JSON.parse(await read('kempo-config.json'));
const pkg = JSON.parse(await read('package.json'));

const walk = async (dir, match) => {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for(const entry of entries){
    const full = path.join(dir, entry.name);
    if(entry.isDirectory()) files.push(...await walk(full, match));
    else if(match(entry.name)) files.push(full);
  }
  return files;
};

const code = name => /\.(js|html)$/.test(name);
const sources = [
  ...await walk(path.join(root, 'public'), code),
  ...await walk(path.join(root, 'server'), name => name.endsWith('.js')),
  ...await walk(path.join(root, 'admin'), code),
  ...await walk(path.join(root, 'hooks'), code),
  ...await walk(path.join(root, 'jobs'), code),
];
const contents = new Map(await Promise.all(sources.map(async file => [file, await readFile(file, 'utf8')])));
const relative = file => path.relative(root, file).replaceAll('\\', '/');
const routes = [...contents].filter(([file]) => relative(file).startsWith('public/api/'));

export default {
  'every permission the code checks is declared': async ({ pass, fail }) => {
    const declared = new Set(config.permissions.map(permission => permission.name));
    for(const [file, text] of contents){
      for(const match of text.matchAll(/['"](forms:[a-z:]+)['"]/g)){
        if(!declared.has(match[1])) return fail(`${relative(file)} uses "${match[1]}", which nothing declares`);
      }
      for(const match of text.matchAll(/has="(forms:[a-z:]+)"/g)){
        if(!declared.has(match[1])) return fail(`${relative(file)} gates on "${match[1]}", which nothing declares`);
      }
    }
    pass(`${declared.size} permissions`);
  },

  'every declared permission is enforced by a route': async ({ pass, fail }) => {
    const text = routes.map(([, source]) => source).join('\n');
    for(const { name } of config.permissions){
      if(!text.includes(`'${name}'`)) return fail(`"${name}" is declared but no route checks it — it grants nothing`);
    }
    pass('');
  },

  'every admin route checks a permission, and only the two public ones do not': async ({ pass, fail }) => {
    for(const [file, text] of routes){
      const name = relative(file);
      const isPublic = name.startsWith('public/api/forms/');
      const gated = /gate(Any)?\(request/.test(text);
      if(isPublic && gated) return fail(`${name} is public but gates on a permission`);
      if(!isPublic && !gated) return fail(`${name} is an admin route with no permission check`);
    }
    pass(`${routes.length} routes`);
  },

  'every group grants only declared permissions, and every permission belongs to a group': async ({ pass, fail }) => {
    const declared = new Set([...config.permissions.map(permission => permission.name), 'system:admin:access']);
    const granted = new Set();
    for(const group of config.groups){
      if(!group.name.startsWith('kempo-forms:')) return fail(`${group.name} should start with kempo-forms:`);
      for(const permission of group.permissions){
        if(!declared.has(permission)) return fail(`${group.name} grants "${permission}", which is not declared`);
        granted.add(permission);
      }
    }
    for(const { name } of config.permissions) if(!granted.has(name)) return fail(`${name} is in no group`);
    pass('');
  },

  'the groups are nested the way the plan says': async ({ pass, fail }) => {
    const group = name => new Set(config.groups.find(entry => entry.name === name).permissions);
    const support = group('kempo-forms:support');
    const editor = group('kempo-forms:editor');
    const administrator = group('kempo-forms:administrator');
    if(support.has('forms:forms:manage')) return fail('support must not change forms');
    if(!editor.has('forms:forms:manage') || editor.has('forms:settings:manage')) return fail('an editor changes forms but not settings');
    if([...config.permissions.map(permission => permission.name)].some(name => !administrator.has(name))) return fail('the administrator has everything');
    pass('');
  },

  'every setting the code reads is declared, with the declared type and default': async ({ pass, fail }) => {
    const declared = new Map(config.settings.map(setting => [setting.name, setting]));
    for(const [key, name] of Object.entries(SETTING_NAMES)){
      const setting = declared.get(name);
      if(!setting) return fail(`"${name}" is read but not declared`);
      const expected = DEFAULTS[key];
      const value = setting.type === 'json' ? JSON.parse(setting.value) : setting.type === 'boolean' ? setting.value === 'true' : setting.type === 'number' ? Number(setting.value) : setting.value;
      if(JSON.stringify(value) !== JSON.stringify(expected)) return fail(`"${name}" is declared as ${JSON.stringify(value)} but defaults to ${JSON.stringify(expected)} in settings.js`);
      if(JSON.stringify(NORMALISE[key](expected)) !== JSON.stringify(expected)) return fail(`the default of "${name}" does not survive its own normaliser`);
    }
    for(const text of contents.values()){
      for(const match of text.matchAll(/(?:getSetting|setSetting)\(OWNER, '([a-z_]+)'/g)){
        if(!declared.has(match[1])) return fail(`"${match[1]}" is read but not declared`);
      }
    }
    pass(`${declared.size} settings`);
  },

  'every setting on the screen can be saved, and nothing else can': async ({ pass, fail }) => {
    const names = new Set(Object.values(SETTING_NAMES));
    for(const name of names) if(!VALIDATORS[name]) return fail(`"${name}" has no validator`);
    for(const name of Object.keys(VALIDATORS)) if(!names.has(name)) return fail(`"${name}" has a validator but is not a setting`);
    pass('');
  },

  'the schema and install.js agree about indexes': async ({ pass, fail }) => {
    const created = new Set(INDEXES.map(index => index.name));
    const declared = new Set();
    for(const table of Object.values(schema)){
      const tableConfig = getTableConfig(table);
      for(const index of tableConfig.indexes) declared.add(index.config.name);
    }
    for(const name of declared) if(!created.has(name)) return fail(`${name} is in the schema but install.js does not create it`);
    for(const name of created) if(!declared.has(name)) return fail(`${name} is created by install.js but not in the schema`);
    if(!INDEXES.find(index => index.name === 'kempoFormsForm_slug_idx').required) return fail('the unique address index must be required');
    pass(`${declared.size} indexes`);
  },

  'every hook and job in the config points at a file that exists': async ({ pass, fail }) => {
    for(const callback of [...Object.values(config.hooks), ...config.jobs.map(job => job.callback)]){
      try {
        await stat(path.join(root, callback));
      } catch {
        return fail(`${callback} does not exist`);
      }
    }
    for(const widget of config.widgets) if(!widget.iconSrc.startsWith('/forms/icons/')) return fail('widget icons come from public/icons');
    pass('');
  },

  'every route and hook can be imported, and exports a function': async ({ pass, fail }) => {
    const files = [...routes.map(([file]) => file), ...[...contents.keys()].filter(file => /\/(hooks|jobs)\//.test(file.replaceAll('\\', '/')))];
    for(const file of files){
      let imported;
      try {
        imported = await import(pathToFileURL(file).href);
      } catch(error) {
        return fail(`${relative(file)} cannot be imported: ${error.message}`);
      }
      if(typeof imported.default !== 'function') return fail(`${relative(file)} does not export a function`);
    }
    pass(`${files.length} modules`);
  },

  'every browser module and server module is valid JavaScript': async ({ pass, fail }) => {
    for(const file of [...contents.keys()].filter(name => name.endsWith('.js'))){
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if(result.status !== 0) return fail(`${relative(file)}: ${result.stderr.split('\n').find(line => line.includes('Error')) || 'does not parse'}`);
    }
    pass(`${[...contents.keys()].filter(name => name.endsWith('.js')).length} files`);
  },

  'the SDK exports what the README promises': async ({ pass, fail }) => {
    const sdk = await import(pathToFileURL(path.join(root, 'sdk.js')).href);
    for(const name of ['createForm', 'updateForm', 'submitForm', 'getSubmission', 'setSubmissionStatus', 'setSubmissionData', 'requestErasure', 'runSweep', 'readConfig']){
      if(typeof sdk[name] !== 'function') return fail(`sdk.js does not export ${name}`);
    }
    pass('');
  },

  'every field type is renderable by the public form and offered by the editor': async ({ pass, fail }) => {
    const form = await read('public/components/Form.js');
    for(const [name, type] of Object.entries(TYPES)){
      if(!['text', 'email', 'tel', 'number', 'textarea', 'select', 'radio', 'checkbox', 'checkboxes', 'file'].includes(name) && !form.includes(`case '${name}':`)) return fail(`Form.js has no way to draw "${name}"`);
      if(!type.label || !type.input) return fail(`"${name}" has no label or input`);
    }
    pass(`${Object.keys(TYPES).length} types`);
  },

  'the README documents every hook, permission, setting and group': async ({ pass, fail }) => {
    const readme = await read('README.md');
    const hooks = new Set();
    for(const text of contents.values()) for(const match of text.matchAll(/\b(?:guard|notify)\('([a-z_]+:[a-z_]+)'/g)) hooks.add(match[1]);
    if(hooks.size < 10) return fail(`only ${hooks.size} hooks found in the code, the scan is wrong`);
    for(const name of hooks) if(!readme.includes(`kempo-forms:${name}`)) return fail(`the README does not document kempo-forms:${name}`);
    for(const { name } of config.permissions) if(!readme.includes(name)) return fail(`the README does not mention ${name}`);
    for(const { name } of config.settings.filter(setting => setting.name !== 'ip_salt')) if(!readme.includes(`\`${name}\``)) return fail(`the README does not mention the setting ${name}`);
    for(const { name } of config.groups) if(!readme.includes(name)) return fail(`the README does not mention ${name}`);
    pass(`${hooks.size} hooks`);
  },

  'the package is shaped like the other extensions': async ({ pass, fail }) => {
    if(pkg.exports['./install'] !== './install.js' || pkg.exports['./sdk'] !== './sdk.js') return fail('exports');
    for(const entry of pkg.files){
      try {
        await stat(path.join(root, entry));
      } catch {
        return fail(`"files" lists ${entry}, which does not exist`);
      }
    }
    const everything = JSON.stringify({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
    if(everything.includes('file:')) return fail('a file: specifier must never be committed');
    for(const dependency of ['re2', 'sanitize-html', 'drizzle-orm']) if(!pkg.dependencies[dependency]) return fail(`${dependency} must be a dependency`);
    pass('');
  },
};
