import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, css, nothing } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Spinner.js';
import { getPublicForm, sendForm } from '/forms/sdk.js';
import { visibleKeys } from '/forms/utils/conditions.js';

/*
  <k-forms-form slug="contact"> draws a form made in the admin, and sends it. Without a slug it uses the last part of the page
  address, which is how the page at /forms/<slug> uses it.

  **Slots** (for other extensions; put an element in one with slot="…", usually through a <location>):
    before-fields   above the first field
    before-submit   above the submit button, inside the form. A captcha goes here: give its hidden input the attribute
                    `data-forms-extra` and a `name`, and its value is sent along with the form for the server hooks to check
    after-form      below the form

  The browser only decides what to show. The server checks everything again from what it receives, so hiding a field here does
  nothing to what is accepted there.

  Fires `submitted` (bubbling) with { message } once the server has accepted the form.
*/

const MODULES = {
  combobox: '/kempo-ui/components/Combobox.js',
  segmented: '/kempo-ui/components/SegmentedControl.js',
  toggle: '/kempo-ui/components/Toggle.js',
  date: '/kempo-ui/components/Calendar.js',
  daterange: '/kempo-ui/components/Calendar.js',
  time: '/kempo-ui/components/Time.js',
  rating: '/kempo-ui/components/Rating.js',
  slider: '/kempo-ui/components/Slider.js',
  color: '/kempo-ui/components/ColorPicker.js',
  tags: '/kempo-ui/components/Tags.js',
  markdown: '/kempo-ui/components/MarkdownEditor.js',
  richtext: '/kempo-ui/components/HtmlEditor.js',
  image: '/kempo-ui/components/ImageCrop.js',
};

const NATIVE = ['text', 'email', 'tel', 'number'];

/*
  Types whose answer is read from the element when the form is sent, not only from the events it fired. A component announces a
  change when a person acts on it, and not every one announces every change (a slider says nothing when its value is set from
  code, a combobox holds the label of what was chosen), so what is on the screen at the moment of sending is what counts.
*/
const READ_ON_SEND = ['combobox', 'slider', 'color', 'markdown', 'richtext', 'tags', 'rating', 'toggle', 'segmented', 'date', 'daterange', 'time'];

/* A slider always has a position and a colour picker always has a colour, so they only count as answered once somebody used them (or the field is required). */
const NEEDS_TOUCH = ['slider', 'color'];

export default class Form extends ShadowComponent {
  static properties = {
    slug: { type: String },
    heading: { type: Number },
    definition: { state: true },
    values: { state: true },
    errors: { state: true },
    phase: { state: true },
    notice: { state: true },
    message: { state: true },
  };

  constructor(){
    super();
    this.slug = '';
    this.heading = 0;
    this.definition = null;
    this.values = {};
    this.errors = {};
    this.phase = 'loading';
    this.notice = '';
    this.message = '';
    this.touched = new Set();
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  updated(changed){
    super.updated(changed);
    for(const element of this.renderRoot.querySelectorAll('k-combobox[data-key]')){
      const field = this.definition?.fields.find(entry => entry.key === element.dataset.key);
      if(field && element.dataset.ready !== 'true' && element.setOptions){
        element.setOptions(field.options.map(option => ({ label: option.label, value: option.value })));
        element.dataset.ready = 'true';
      }
    }
  }

  /*
    Overridable
  */

  /* Whether this is the page builder's copy, which draws the form but never sends it, and never reads a form from the address. */
  get editing(){
    return false;
  }

  /*
    Data
  */

  load = async () => {
    const slug = this.slug || (this.editing ? '' : decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || ''));
    if(!slug) return;
    const [error, data] = await getPublicForm(slug);
    if(error || (!this.slug && !data.form.standalone)){
      this.phase = 'missing';
      return;
    }
    await Promise.all([...new Set(data.form.fields.map(field => MODULES[field.type]).filter(Boolean))].map(path => import(path)));
    this.definition = data.form;
    if(this.heading === 1 && !this.editing) document.title = data.form.title;
    this.values = Object.fromEntries(data.form.fields.filter(field => field.type === 'checkbox' || field.type === 'toggle').map(field => [field.key, false]));
    this.phase = data.form.closed ? 'closed' : 'ready';
  };

  set = (key, value) => {
    this.touched.add(key);
    this.values = { ...this.values, [key]: value };
    if(this.errors[key]) this.errors = { ...this.errors, [key]: '' };
  };

  /*
    The value a kempo-ui or native control holds, in the form the server expects.
  */
  read = (field, element) => {
    switch(field.type){
      case 'checkbox': return element.checked;
      case 'toggle': return Boolean(element.value);
      case 'rating': return Number(element.value) || 0;
      case 'tags': return String(element.value || '').split(',').map(tag => tag.trim()).filter(Boolean);
      case 'daterange': return String(element.value || '').split(',').filter(Boolean);
      case 'slider': return String(element.value ?? '');
      case 'combobox': return field.options.find(option => option.label === element.value)?.value ?? '';
      case 'color': {
        const color = String(element.value || '');
        return /^#[0-9a-f]{8}$/i.test(color) && !field.settings?.allowAlpha && color.toLowerCase().endsWith('ff') ? color.slice(0, 7) : color;
      }
      default: return element.value;
    }
  };

  changed = (field, event) => this.set(field.key, this.read(field, event.currentTarget));

  toggleOption = (field, option, event) => {
    const current = Array.isArray(this.values[field.key]) ? this.values[field.key] : [];
    this.set(field.key, event.target.checked ? [...current, option.value] : current.filter(value => value !== option.value));
  };

  /*
    Sending
  */

  extras = () => {
    const extras = {};
    const honeypot = this.renderRoot.querySelector('[name="website_url"]');
    if(honeypot) extras.website_url = honeypot.value;
    for(const element of this.querySelectorAll('[data-forms-extra]')){
      const name = element.getAttribute('name') || element.name;
      if(name) extras[name] = element.value ?? '';
    }
    return extras;
  };

  files = async visible => {
    const files = {};
    for(const field of this.definition.fields.filter(entry => visible.has(entry.key))){
      if(field.type === 'file') files[field.key] = [...(this.renderRoot.querySelector(`input[type="file"][data-key="${field.key}"]`)?.files || [])];
      if(field.type === 'image'){
        const file = await this.renderRoot.querySelector(`k-image-crop[data-key="${field.key}"]`)?.toFile?.();
        files[field.key] = file ? [file] : [];
      }
    }
    return files;
  };

  submit = async event => {
    event.preventDefault();
    if(this.editing) return;
    const form = event.currentTarget;
    if(!form.reportValidity()) return;

    const fields = this.definition.fields;
    const visible = visibleKeys(fields, this.values);
    const live = { ...this.values };
    for(const field of fields.filter(entry => visible.has(entry.key) && READ_ON_SEND.includes(entry.type))){
      const element = this.renderRoot.querySelector(`[data-key="${field.key}"]`);
      if(!element) continue;
      if(NEEDS_TOUCH.includes(field.type) && !field.required && !this.touched.has(field.key)) delete live[field.key];
      else live[field.key] = this.read(field, element);
    }
    const values = Object.fromEntries(Object.entries(live).filter(([key]) => visible.has(key)));

    this.phase = 'sending';
    this.notice = '';
    const [error, result] = await sendForm(this.definition.slug, { values, extras: this.extras(), files: await this.files(visible) });

    if(error){
      this.phase = 'ready';
      this.errors = error.errors || {};
      this.notice = error.msg;
      await this.updateComplete;
      const first = Object.keys(this.errors).find(key => this.errors[key]);
      this.renderRoot.getElementById(`field-${first}`)?.focus();
      return;
    }

    this.message = result.message;
    this.phase = 'done';
    this.dispatchEvent(new CustomEvent('submitted', { detail: { message: result.message }, bubbles: true, composed: true }));
    if(result.redirectUrl) location.assign(result.redirectUrl);
  };

  /*
    Rendering
  */

  describedBy = field => [field.hint ? `hint-${field.key}` : '', this.errors[field.key] ? `error-${field.key}` : ''].filter(Boolean).join(' ') || nothing;

  #label(field){
    return html`<label class="d-b mbq" for=${`field-${field.key}`}>${field.label}${field.required ? html`<span class="tc-danger" aria-hidden="true"> *</span>` : nothing}${field.hint ? html`<small class="d-b tc-muted" id=${`hint-${field.key}`}>${field.hint}</small>` : nothing}</label>`;
  }

  #error(field){
    return this.errors[field.key] ? html`<small class="d-b tc-danger" role="alert" id=${`error-${field.key}`}>${this.errors[field.key]}</small>` : nothing;
  }

  #group(field, body){
    return html`<div class="mb" role="group" aria-labelledby=${`label-${field.key}`}>
      <span class="d-b mbq" id=${`label-${field.key}`}>${field.label}${field.required ? html`<span class="tc-danger" aria-hidden="true"> *</span>` : nothing}${field.hint ? html`<small class="d-b tc-muted" id=${`hint-${field.key}`}>${field.hint}</small>` : nothing}</span>
      ${body}${this.#error(field)}
    </div>`;
  }

  #input(field){
    const id = `field-${field.key}`;
    const value = this.values[field.key];

    if(NATIVE.includes(field.type)){
      return html`<input
        type=${field.type} name=${field.key} id=${id} .value=${value ?? ''} placeholder=${field.placeholder || nothing}
        ?required=${field.required} minlength=${field.minLength ?? nothing} maxlength=${field.maxLength ?? nothing}
        pattern=${field.pattern || nothing} min=${field.settings?.min ?? nothing} max=${field.settings?.max ?? nothing}
        aria-describedby=${this.describedBy(field)} @input=${event => this.set(field.key, event.target.value)}>`;
    }

    switch(field.type){
      case 'textarea':
        return html`<textarea name=${field.key} id=${id} rows="5" .value=${value ?? ''} placeholder=${field.placeholder || nothing} ?required=${field.required}
          minlength=${field.minLength ?? nothing} maxlength=${field.maxLength ?? nothing} aria-describedby=${this.describedBy(field)} @input=${event => this.set(field.key, event.target.value)}></textarea>`;
      case 'select':
        return html`<select name=${field.key} id=${id} ?required=${field.required} aria-describedby=${this.describedBy(field)} @change=${event => this.set(field.key, event.target.value)}>
          <option value="" ?selected=${!value}>${field.placeholder || 'Choose one'}</option>
          ${field.options.map(option => html`<option value=${option.value} ?selected=${value === option.value}>${option.label}</option>`)}
        </select>`;
      case 'combobox':
        return html`<k-combobox data-key=${field.key} name=${field.key} id=${id} .value=${field.options.find(option => option.value === value)?.label ?? ''} placeholder=${field.placeholder || nothing} ?required=${field.required} require-match @change=${event => this.changed(field, event)}></k-combobox>`;
      case 'segmented':
        return html`<k-segmented-control data-key=${field.key} name=${field.key} id=${id} .value=${value ?? ''} @change=${event => this.changed(field, event)}>
          ${field.options.map(option => html`<k-sc-option value=${option.value}>${option.label}</k-sc-option>`)}
        </k-segmented-control>`;
      case 'toggle':
        return html`<k-toggle data-key=${field.key} id=${id} .value=${Boolean(value)} @change=${event => this.changed(field, event)}></k-toggle>`;
      case 'date':
        return html`<k-calendar data-key=${field.key} name=${field.key} id=${id} mode="single" .value=${value ?? ''} min=${field.settings?.min || nothing} max=${field.settings?.max || nothing} ?required=${field.required} @change=${event => this.changed(field, event)}></k-calendar>`;
      case 'daterange':
        return html`<k-calendar data-key=${field.key} name=${field.key} id=${id} mode="range" .value=${Array.isArray(value) ? value.join(',') : (value ?? '')} ?required=${field.required} @change=${event => this.set(field.key, String(event.currentTarget.value || '').split(',').filter(Boolean))}></k-calendar>`;
      case 'time':
        return html`<k-time data-key=${field.key} name=${field.key} id=${id} .value=${value ?? ''} increment=${field.settings?.increment ?? nothing} ?required=${field.required} @change=${event => this.changed(field, event)}></k-time>`;
      case 'rating':
        return html`<k-rating data-key=${field.key} name=${field.key} id=${id} .value=${Number(value) || 0} @change=${event => this.changed(field, event)}></k-rating>`;
      case 'slider':
        return html`<k-slider data-key=${field.key} name=${field.key} id=${id} min=${field.settings?.min ?? 0} max=${field.settings?.max ?? 100} format=${field.settings?.format || nothing} tooltip
          .value=${Array.isArray(value) ? value.join(',') : String(value ?? (field.settings?.range ? `${field.settings?.min ?? 0},${field.settings?.max ?? 100}` : field.settings?.min ?? 0))}
          @change=${event => this.set(field.key, event.currentTarget.value)}></k-slider>`;
      case 'color':
        return html`<k-color-picker data-key=${field.key} name=${field.key} id=${id} .value=${value ?? '#000000'} @change=${event => this.changed(field, event)} @input=${event => this.changed(field, event)}></k-color-picker>`;
      case 'tags':
        return html`<k-tags data-key=${field.key} id=${id} .value=${(value || []).join(',')} allowed-tags=${field.settings?.onlySuggestions ? field.options.map(option => option.value).join(',') : nothing} @change=${event => this.changed(field, event)}></k-tags>`;
      case 'markdown':
        return html`<k-markdown-editor data-key=${field.key} name=${field.key} id=${id} controls="minimal" .value=${value ?? ''} placeholder=${field.placeholder || nothing} ?required=${field.required} @input=${event => this.changed(field, event)} @change=${event => this.changed(field, event)}></k-markdown-editor>`;
      case 'richtext':
        return html`<k-html-editor data-key=${field.key} name=${field.key} id=${id} controls="minimal" .value=${value ?? ''} ?required=${field.required} @change=${event => this.changed(field, event)}></k-html-editor>`;
      case 'file':
        return html`<input type="file" data-key=${field.key} name=${field.key} id=${id} multiple accept=${field.settings?.accept ? field.settings.accept.map(extension => `.${extension}`).join(',') : nothing} ?required=${field.required} aria-describedby=${this.describedBy(field)}>`;
      case 'image':
        return html`<k-image-crop data-key=${field.key} name=${field.key} id=${id} ?required=${field.required} aspect-ratio=${field.settings?.aspectRatio || nothing}></k-image-crop>`;
      default:
        return nothing;
    }
  }

  #field(field){
    const value = this.values[field.key];

    switch(field.type){
      case 'checkbox':
        return html`<div class="mb"><label class="checkbox"><input type="checkbox" name=${field.key} id=${`field-${field.key}`} .checked=${Boolean(value)} ?required=${field.required} aria-describedby=${this.describedBy(field)} @change=${event => this.changed(field, event)}> ${field.label}${field.required ? html`<span class="tc-danger" aria-hidden="true"> *</span>` : nothing}${field.hint ? html`<small class="d-b tc-muted" id=${`hint-${field.key}`}>${field.hint}</small>` : nothing}</label>${this.#error(field)}</div>`;
      case 'radio':
        return this.#group(field, field.options.map(option => html`<label class="d-b"><input type="radio" name=${field.key} value=${option.value} .checked=${value === option.value} ?required=${field.required} @change=${() => this.set(field.key, option.value)}> ${option.label}</label>`));
      case 'checkboxes':
        return this.#group(field, field.options.map(option => html`<label class="d-b"><input type="checkbox" name=${field.key} value=${option.value} .checked=${Array.isArray(value) && value.includes(option.value)} @change=${event => this.toggleOption(field, option, event)}> ${option.label}</label>`));
      case 'toggle':
        return html`<div class="mb">${this.#label(field)}${this.#input(field)}${this.#error(field)}</div>`;
      default:
        return html`<div class="mb">${this.#label(field)}${this.#input(field)}${this.#error(field)}</div>`;
    }
  }

  #title(form){
    const title = [null, html`<h1>${form.title}</h1>`, html`<h2>${form.title}</h2>`, html`<h3>${form.title}</h3>`, html`<h4>${form.title}</h4>`, html`<h5>${form.title}</h5>`, html`<h6>${form.title}</h6>`][this.heading];
    return html`${title}${title && form.description ? html`<p class="tc-muted">${form.description}</p>` : nothing}`;
  }

  #notice(text){
    return html`<p class="tc-muted">${text}</p>`;
  }

  render(){
    if(this.phase === 'loading') return html`<k-spinner></k-spinner>`;
    if(this.phase === 'missing') return this.#notice('This form is not available.');
    if(this.phase === 'closed') return this.#notice('This form is not accepting submissions right now.');
    if(this.phase === 'done') return html`<p role="status">${this.message}</p>`;

    const form = this.definition;
    if(form.needsAccount && !form.signedIn){
      return html`<p>You need to <a href=${`/login/?next=${encodeURIComponent(location.pathname + location.search)}`}>sign in</a> to send this form.</p>`;
    }

    const visible = visibleKeys(form.fields, this.values);
    return html`
      ${this.#title(form)}
      <form @submit=${this.submit}>
        <slot name="before-fields"></slot>
        ${this.notice ? html`<p class="tc-danger" role="alert">${this.notice}</p>` : nothing}
        ${form.fields.filter(field => visible.has(field.key)).map(field => this.#field(field))}
        <div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="website_url" tabindex="-1" autocomplete="off"></label></div>
        <slot name="before-submit"></slot>
        <button type="submit" class="primary" ?disabled=${this.phase === 'sending'}>${this.phase === 'sending' ? 'Sending…' : form.submitLabel}</button>
      </form>
      <slot name="after-form"></slot>
    `;
  }

  static styles = css`
    :host { display: block; }
    .hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
  `;
}

customElements.define('k-forms-form', Form);
