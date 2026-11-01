import WidgetEditor from '/kempo/sitebuilder/components/WidgetEditor.js';
import { html, css } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import { listForms } from '/forms/sdk.js';

/*
  The Form widget as the page builder shows it: a card that says which form goes here, in place of the form itself (the real
  form would load, validate and send in the middle of the editor). On the page it is `<k-forms-form slug="..." heading="...">`.
  Each form is looked up once and kept, since the editor draws the page again after every change.
*/
const lookups = new Map();

const lookup = slug => {
  if(!lookups.has(slug)) lookups.set(slug, listForms({ search: slug, limit: 50 }).then(([error, data]) => (error ? undefined : data.items.find(item => item.slug === slug) ?? null)));
  return lookups.get(slug);
};

export default class FormWidgetEditor extends WidgetEditor {
  static properties = {
    ...WidgetEditor.properties,
    slug: { type: String, reflect: true },
    heading: { type: Number, reflect: true },
    form: { state: true }
  };

  /* Like the form on the page, it is a block: an inline element has no outline of its own around what it holds, and no vertical margin. */
  static styles = css`
    :host { display: block; }
  `;

  constructor(){
    super();
    this.slug = '';
    this.heading = 0;
    this.form = undefined;
  }

  willUpdate(changed){
    if(changed.has('slug')){
      this.form = undefined;
      if(this.slug) lookup(this.slug).then(form => { if(this.isConnected) this.form = form; });
    }
  }

  render(){
    const message = !this.slug
      ? 'Choose the form to show here in the settings.'
      : this.form === null
        ? 'There is no form with this address, so nothing will show here.'
        : 'The form is shown here on the page. Edit its fields on the form\'s own page.';
    return html`
      <div class="b r p">
        <div><k-icon src="/forms/icons/assignment.svg"></k-icon> <strong>${this.form?.title ?? (this.slug || 'Form')}</strong></div>
        <p class="tc-muted m0">${message}</p>
      </div>
    `;
  }
}

customElements.define('k-forms-form-editor', FormWidgetEditor);
