import { html, render } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import { listForms } from '/forms/sdk.js';

/*
  A form placed in a page, as the content editor shows it: a card that says which form goes here and links to where it is edited,
  instead of the form itself. In the page it is saved as `<k-forms-form slug="..." heading="...">`, so nothing here is stored
  other than those two attributes. The editor loads it through its `nodes` attribute (see kempo's registerEditorExtension).

  Lexical must be the same copy the editor uses, so it is loaded from the same place and version as kempo-ui's HtmlEditor does.
*/
const LEXICAL_VERSION = '0.43.0';
const { DecoratorNode, $applyNodeReplacement, $getRoot, $getSelection, $getNodeByKey, $isRangeSelection, $createParagraphNode } = await import(`${window.kempo?.lexicalUrl || 'https://esm.sh'}/lexical@${LEXICAL_VERSION}`);

class FormLexicalNode extends DecoratorNode {
  static getType(){
    return 'k-forms-form';
  }

  static clone(node){
    return new FormLexicalNode(node.__slug, node.__heading, node.__key);
  }

  static isVisualCompatible(domNode){
    return domNode.nodeType === Node.ELEMENT_NODE && domNode.tagName === 'K-FORMS-FORM';
  }

  static importDOM(){
    return {
      'k-forms-form': () => ({
        conversion: element => ({ node: $createFormNode(element.getAttribute('slug') || '', element.getAttribute('heading') || '') }),
        priority: 2,
      }),
    };
  }

  static importJSON(json){
    return $createFormNode(json.slug, json.heading);
  }

  constructor(slug = '', heading = '', key){
    super(key);
    this.__slug = slug;
    this.__heading = heading;
  }

  /*
    `form` is undefined while it is being looked up, null when no form has this address, and the form once found.
  */
  createDOM(config, editor){
    const container = document.createElement('div');
    const slug = this.__slug;
    const key = this.__key;
    const remove = () => editor.update(() => $getNodeByKey(key)?.remove());
    /* One line on purpose: the editor's text is pre-wrap, so any whitespace between these tags would be drawn as a blank line. */
    const draw = form => render(html`<div class="b r pq" contenteditable="false" data-forms-slug=${slug}><div><k-icon src="/forms/icons/assignment.svg"></k-icon> <strong>${form?.title ?? slug}</strong></div><p class="tc-muted m0">${form === null ? 'There is no form with this address, so nothing will show here.' : 'Shown here on the page. Edit its fields on the form\'s own page.'}</p><div class="mtq">${form ? html`<a class="btn mr" href=${`/admin/extension/kempo-forms/form/?id=${encodeURIComponent(form.id)}`} target="_blank" rel="noopener" @mousedown=${event => event.stopPropagation()}>Edit form</a>` : ''}<button class="danger" @mousedown=${event => event.stopPropagation()} @click=${remove}><k-icon name="delete"></k-icon> Remove</button></div></div>`, container);
    draw(undefined);
    listForms({ search: slug, limit: 50 }).then(([error, data]) => {
      if(!error) draw(data.items.find(item => item.slug === slug) ?? null);
    });
    return container;
  }

  updateDOM(){
    return false;
  }

  exportDOM(){
    const element = document.createElement('k-forms-form');
    element.setAttribute('slug', this.__slug);
    if(this.__heading) element.setAttribute('heading', this.__heading);
    return { element };
  }

  exportJSON(){
    return { ...super.exportJSON(), type: 'k-forms-form', slug: this.__slug, heading: this.__heading };
  }

  isInline(){
    return false;
  }

  isKeyboardSelectable(){
    return true;
  }

  decorate(){
    return null;
  }
}

const $createFormNode = (slug = '', heading = '') => $applyNodeReplacement(new FormLexicalNode(slug, heading));

/*
  Puts a form after the block the cursor is in, or at the end of the page when the editor has no cursor yet. An empty paragraph
  always follows it, and the cursor moves into that paragraph, so typing can carry on below the form.
*/
export const insertFormNode = (editor, slug) => editor?.update(() => {
  const selection = $getSelection();
  const block = $isRangeSelection(selection) ? selection.anchor.getNode().getTopLevelElement?.() : null;
  const node = $createFormNode(slug);
  const paragraph = $createParagraphNode();
  if(block) block.insertAfter(node);
  else $getRoot().append(node);
  node.insertAfter(paragraph);
  paragraph.select();
});

export default { lexicalNode: FormLexicalNode };
