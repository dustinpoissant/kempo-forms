import { access, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/*
  The Form widget the page builder offers. kempo's own registry code cleans the declaration (so a declaration it would refuse
  fails here and not in somebody's editor), and kempo-ui's page renderer takes a page through the widget, on the page and
  in the editor. The kempo-ui modules are loaded from kempo's own copy, so they are the ones kempo's registry adds the
  widget to.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async file => import(pathToFileURL(file).href);
const kempo = relative => load(path.join(root, 'node_modules', 'kempo', relative));
const ui = relative => load(path.join(root, 'node_modules', 'kempo', 'node_modules', 'kempo-ui', 'src', relative));

const config = JSON.parse(await readFile(path.join(root, 'kempo-config.json'), 'utf8'));
const { normalizeExtensionWidget } = await kempo('server/utils/sitebuilder/registry.js');
const { widgets, addWidget, registryOf } = await ui('utils/pageWidgets.js');
const { renderPage, collectModules } = await ui('utils/renderPage.js');
const { createNode } = await ui('utils/pageTree.js');

const [error, widget] = normalizeExtensionWidget('kempo-forms', config.page_widgets[0]);
if(!error) addWidget(widget);
const registry = registryOf(widgets);
const name = 'kempo-forms-form';

export default {
  'the declaration is one kempo accepts': async ({ pass, fail }) => {
    if(config.page_widgets.length !== 1) return fail('expected the one Form widget');
    if(error) return fail(error.msg);
    if(widget.name !== name || widget.tag !== 'k-forms-form') return fail(JSON.stringify([widget.name, widget.tag]));
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
    const plain = renderPage([createNode(name, { slug: 'contact' })], registry);
    if(!plain.startsWith('<k-forms-form') || !plain.includes('slug="contact"') || plain.includes('heading=')) return fail(plain);
    const headed = renderPage([createNode(name, { slug: 'contact', heading: '2' })], registry);
    if(!headed.includes('slug="contact"') || !headed.includes('heading="2"')) return fail(headed);
    pass('');
  },

  'a page that holds a form loads the form component, and the editor loads its own element as well': async ({ pass, fail }) => {
    const nodes = [createNode(name, { slug: 'contact' })];
    const onPage = collectModules(nodes, registry);
    if(onPage.join() !== '/forms/components/Form.js') return fail(onPage.join());
    const inEditor = collectModules(nodes, registry, { editor: true });
    if(!inEditor.includes('/admin/extension/kempo-forms/components/sitebuilder/FormWidgetEditor.js')) return fail(inEditor.join());
    pass('');
  },

  'the editor is written as its own element, with the same settings as the form': async ({ pass, fail }) => {
    const html = renderPage([createNode(name, { slug: 'contact', heading: '2' })], registry, { editor: true });
    if(!html.startsWith('<k-forms-form-editor') || !html.includes('slug="contact"') || !html.includes('heading="2"')) return fail(html);
    pass('');
  },

  'the editor draws the form with the page\'s own component, and never sends it': async ({ pass, fail }) => {
    const editor = await readFile(path.join(root, 'admin/components/sitebuilder/FormWidgetEditor.js'), 'utf8');
    const form = await readFile(path.join(root, 'public/components/Form.js'), 'utf8');
    if(!editor.includes("import Form from '/forms/components/Form.js'") || !editor.includes('extends Form') || !editor.includes('get editing()')) return fail('the editor does not draw the form itself');
    if(editor.includes('sendForm') || editor.includes('render(){\n    return html`<div class="b r p">')) return fail('the editor is a card or sends');
    if(!/submit = async event => \{\s*event\.preventDefault\(\);\s*if\(this\.editing\) return;/.test(form)) return fail('the form can be sent from the editor');
    if(!form.includes('this.heading === 1 && !this.editing') || !form.includes("(this.editing ? '' :")) return fail('the editor changes the title of the page or reads the address');
    pass('');
  }
};
