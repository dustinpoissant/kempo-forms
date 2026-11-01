import { access, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/*
  The Form widget the page builder offers. kempo's own registry code cleans the declaration (so a declaration it would refuse
  fails here and not in somebody's editor), and kempo's renderer and page reader take a page through the widget and back.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kempo = async relative => import(pathToFileURL(path.join(root, 'node_modules', 'kempo', relative)).href);

const config = JSON.parse(await readFile(path.join(root, 'kempo-config.json'), 'utf8'));
const { normalizeExtensionWidget } = await kempo('server/utils/sitebuilder/registry.js');
const { buildRegistry } = await kempo('src/kempo/sitebuilder/registry.js');
const { renderLocation } = await kempo('src/kempo/sitebuilder/render.js');
const { createNode } = await kempo('src/kempo/sitebuilder/nodes.js');
const rebuild = (await kempo('server/utils/sitebuilder/rebuild.js')).default;

const [error, widget] = normalizeExtensionWidget('kempo-forms', config.page_widgets[0]);
const registry = buildRegistry(error ? [] : [widget]);
const ctx = { registry };
const key = 'kempo-forms:form';

const roundTrip = html => {
  const [rebuildError, tree] = rebuild(html, registry);
  return rebuildError ? { error: rebuildError.msg } : { tree, again: renderLocation(tree, ctx) };
};

export default {
  'the declaration is one kempo accepts': async ({ pass, fail }) => {
    if(config.page_widgets.length !== 1) return fail('expected the one Form widget');
    if(error) return fail(error.msg);
    if(widget.key !== key || widget.tag !== 'k-forms-form') return fail(JSON.stringify([widget.key, widget.tag]));
    pass('');
  },

  'the files the declaration points at exist': async ({ pass, fail }) => {
    const { page_component, editor_component, settings_component, iconSrc } = config.page_widgets[0];
    const files = {
      [page_component]: 'public/components/Form.js',
      [editor_component]: `admin/${editor_component.split('/kempo-forms/')[1]}`,
      [settings_component]: `admin/${settings_component.split('/kempo-forms/')[1]}`,
      [iconSrc]: `public/${iconSrc.replace(/^\/forms\//, '')}`
    };
    for(const [url, file] of Object.entries(files)){
      try {
        await access(path.join(root, file));
      } catch {
        return fail(`${url} should be ${file}, which does not exist`);
      }
    }
    pass('');
  },

  'a form in a page is written as the element the form component reads': async ({ pass, fail }) => {
    const plain = renderLocation([createNode(key, { slug: 'contact' })], ctx);
    if(!plain.startsWith('<k-forms-form slug="contact"></k-forms-form>')) return fail(plain);
    const headed = renderLocation([createNode(key, { slug: 'contact', heading: '2' })], ctx);
    if(!headed.startsWith('<k-forms-form slug="contact" heading="2"></k-forms-form>')) return fail(headed);
    pass('');
  },

  'a page that holds a form reads back as the Form widget, and renders the same': async ({ pass, fail }) => {
    for(const html of ['<k-forms-form slug="contact"></k-forms-form>', '<k-forms-form slug="quote" heading="1"></k-forms-form>']){
      const { tree, again, error: readError } = roundTrip(html);
      if(readError) return fail(readError);
      if(tree.length !== 1 || tree[0].type !== key) return fail(JSON.stringify(tree));
      if(!again.startsWith(html)) return fail(`${html} came back as ${again}`);
    }
    pass('');
  },

  'the editor shows the card, not the form': async ({ pass, fail }) => {
    const html = renderLocation([createNode(key, { slug: 'contact' })], { registry, editor: true });
    if(!html.startsWith('<k-forms-form-editor slug="contact"')) return fail(html);
    pass('');
  }
};
