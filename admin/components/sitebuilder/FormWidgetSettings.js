import WidgetSettings from '/kempo-ui/components/pagebuilder/WidgetSettings.js';
import { html } from '/kempo-ui/lit-all.min.js';
import { listForms } from '/forms/sdk.js';

/*
  The settings of the Form widget: the form is chosen from the forms made in the admin, so nobody types an address. Someone who
  may not see the forms list gets the plain address field instead.
*/
export default class FormWidgetSettings extends WidgetSettings {
  static properties = {
    ...WidgetSettings.properties,
    forms: { state: true },
    failed: { state: true }
  };

  constructor(){
    super();
    this.forms = null;
    this.failed = false;
  }

  connectedCallback(){
    super.connectedCallback();
    listForms({ limit: 200 }).then(([error, data]) => {
      this.failed = !!error;
      this.forms = error ? [] : data.items;
    });
  }

  render(){
    if(this.failed) return this.renderFields();
    if(!this.forms) return html`<p class="tc-muted">Loading the forms</p>`;
    const slug = this.node.attrs?.slug || '';
    const current = this.forms.find(form => form.slug === slug);
    return html`
      <div class="mb">
        <label class="d-b mbq" for="form">Form<small class="d-b tc-muted">The form shown here. Forms are made under Forms in the admin.</small></label>
        <select id="form" class="full" @change="${event => this.set('slug', event.target.value, false)}">
          <option value="" ?selected="${!slug}">Choose a form</option>
          ${this.forms.map(form => html`<option value="${form.slug}" ?selected="${form.slug === slug}">${form.title}</option>`)}
          ${slug && !current ? html`<option value="${slug}" selected>${slug} (not found)</option>` : ''}
        </select>
        ${current ? html`<a class="btn mtq" href="/admin/extension/kempo-forms/form/?id=${encodeURIComponent(current.id)}" target="_blank" rel="noopener">Edit this form</a>` : ''}
        ${this.forms.length ? '' : html`<p class="tc-muted mtq">There are no forms yet. <a href="/admin/extension/kempo-forms/" target="_blank" rel="noopener">Make one</a>.</p>`}
      </div>
      ${this.renderFields(['slug'])}
    `;
  }
}

customElements.define('k-forms-form-settings', FormWidgetSettings);
