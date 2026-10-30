import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, nothing, repeat, keyed } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import '/kempo-ui/components/Tabs.js';
import '/kempo-ui/components/Accordion.js';
import '/kempo-ui/components/Sortable.js';
import '/kempo-ui/components/Tags.js';
import './RuleEditor.js';
import { createForm, duplicateForm, getForm, getMeta, setFormStatus, updateForm } from '/forms/sdk.js';
import { Toast, confirm, plural } from './ui.js';
import permissions from './permissions.js';

/*
  The form editor, a page of its own (so the address changes and the back button works): ?id= to change a form, nothing to make
  a new one. Everything about the form is one record, saved together with the Save button at the top. Five tabs: the fields
  themselves, the form's own settings, who is told about submissions, spam rules for this form, and how to put it on a page.

  Fields can be dragged into order. A field can be shown only when an earlier field has a given answer, so the "Show when" choices
  only ever offer the fields above it; dragging a field above the one it depends on takes the condition off, and says so.
*/

const OPERATOR_LABELS = {
  equals: 'is',
  'not-equals': 'is not',
  includes: 'includes',
  checked: 'is ticked',
  'not-checked': 'is not ticked',
  empty: 'is empty',
  'not-empty': 'is not empty',
};

const SETTING_KEYS = ['title', 'slug', 'description', 'fields', 'submitLabel', 'successMessage', 'redirectUrl', 'standalonePage', 'accountRequirement', 'notifyEmails', 'useDefaultRecipients', 'sendConfirmation', 'confirmationField', 'confirmationSubject', 'confirmationMessage', 'spamRules'];

const NEW_FORM = () => ({
  title: '',
  slug: '',
  description: '',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: '', hint: '', options: [], personal: false, settings: {} },
    { key: 'email', label: 'Email', type: 'email', required: true, placeholder: '', hint: '', options: [], personal: true, settings: {} },
    { key: 'message', label: 'Message', type: 'textarea', required: true, placeholder: '', hint: '', options: [], personal: false, settings: {} },
  ],
  submitLabel: 'Send',
  successMessage: 'Thank you. Your message has been sent.',
  redirectUrl: '',
  standalonePage: true,
  accountRequirement: 'inherit',
  notifyEmails: [],
  useDefaultRecipients: true,
  sendConfirmation: false,
  confirmationField: '',
  confirmationSubject: 'We received your message',
  confirmationMessage: '',
  spamRules: [],
});

let counter = 0;
const uid = () => `f${Date.now().toString(36)}${counter++}`;

const keyFrom = label => String(label).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[0-9]+/, '').slice(0, 40);

const slugFrom = title => String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const optionsToText = options => (options || []).map(option => option.value === option.label ? option.label : `${option.value} | ${option.label}`).join('\n');

const textToOptions = text => text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
  const [value, ...label] = line.split('|');
  return { value: value.trim(), label: (label.join('|').trim() || value.trim()) };
});

const tidy = field => ({ ...field, optionsText: optionsToText(field.options) });

const asNumber = value => value === '' || value === undefined ? undefined : Number(value);

export default class FormEditor extends ShadowComponent {
  static properties = {
    formId: { type: String },
    draft: { state: true },
    saved: { state: true },
    form: { state: true },
    meta: { state: true },
    loading: { state: true },
    saving: { state: true },
    error: { state: true },
    version: { state: true },
    canManage: { state: true },
  };

  constructor(){
    super();
    this.formId = new URLSearchParams(location.search).get('id') || '';
    this.draft = null;
    this.saved = '';
    this.form = null;
    this.meta = null;
    this.loading = true;
    this.saving = false;
    this.error = '';
    this.version = 0;
    this.canManage = false;
    this.slugTouched = false;
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    window.addEventListener('beforeunload', this.warnIfUnsaved);
    this.start();
  }

  disconnectedCallback(){
    super.disconnectedCallback();
    window.removeEventListener('beforeunload', this.warnIfUnsaved);
  }

  warnIfUnsaved = event => {
    if(this.dirty) event.preventDefault();
  };

  start = async () => {
    this.canManage = (await permissions()).has('forms:forms:manage');
    const [metaError, meta] = await getMeta();
    if(metaError){
      this.error = metaError.msg;
      this.loading = false;
      return;
    }
    this.meta = meta;

    if(this.formId){
      const [error, data] = await getForm(this.formId);
      if(error){
        this.error = error.msg;
        this.loading = false;
        return;
      }
      this.form = data.form;
      this.adopt(data.form);
      this.slugTouched = true;
    } else {
      this.adopt(NEW_FORM());
    }
    this.loading = false;
  };

  /*
    State
  */

  adopt = source => {
    const draft = Object.fromEntries(SETTING_KEYS.map(key => [key, structuredClone(source[key] ?? NEW_FORM()[key])]));
    draft.redirectUrl = draft.redirectUrl || '';
    draft.confirmationField = draft.confirmationField || '';
    draft.fields = draft.fields.map(field => ({ ...tidy(field), uid: uid(), keyTouched: true }));
    this.draft = draft;
    this.saved = this.snapshot();
  };

  payload = () => ({
    ...this.draft,
    redirectUrl: this.draft.redirectUrl || null,
    confirmationField: this.draft.confirmationField || null,
    fields: this.draft.fields.map(({ uid: id, keyTouched, optionsText, ...field }) => ({
      ...field,
      options: ['select', 'combobox', 'radio', 'segmented', 'checkboxes', 'tags'].includes(field.type) ? textToOptions(optionsText) : [],
    })),
  });

  snapshot = () => JSON.stringify(this.payload());

  get dirty(){
    return Boolean(this.draft) && this.snapshot() !== this.saved;
  }

  change = changes => {
    this.draft = { ...this.draft, ...changes };
  };

  changeField = (uidValue, changes) => {
    this.draft = { ...this.draft, fields: this.draft.fields.map(field => field.uid === uidValue ? { ...field, ...changes } : field) };
  };

  changeSetting = (field, name, value) => this.changeField(field.uid, { settings: { ...field.settings, [name]: value === undefined || value === '' || Number.isNaN(value) ? undefined : value } });

  typeOf = type => this.meta.types.find(entry => entry.key === type);

  /*
    Fields
  */

  freshKey = base => {
    const stem = keyFrom(base) || 'field';
    let key = stem;
    for(let number = 2; this.draft.fields.some(field => field.key === key); number++) key = `${stem}_${number}`.slice(0, 40);
    return key;
  };

  addField = event => {
    const select = event.currentTarget.closest('div').querySelector('select');
    const type = this.typeOf(select.value);
    if(!type) return;
    const field = {
      uid: uid(),
      keyTouched: false,
      key: this.freshKey(type.label),
      label: type.label,
      type: type.key,
      required: false,
      placeholder: '',
      hint: '',
      options: [],
      optionsText: type.choices ? 'Option 1\nOption 2' : '',
      personal: ['email', 'tel'].includes(type.key),
      settings: {},
    };
    this.change({ fields: [...this.draft.fields, field] });
  };

  removeField = async field => {
    if(this.form?.submissionCount && this.form.fields.some(saved => saved.key === field.key)){
      const agreed = await confirm(`${plural(this.form.submissionCount, 'submission')} already sent keep their answer to "${field.label}". Removing the field only stops it being asked from now on.`, { title: 'Remove this field?', yes: 'Remove it' });
      if(!agreed) return;
    }
    this.change({ fields: this.draft.fields.filter(entry => entry.uid !== field.uid).map(entry => entry.showWhen?.key === field.key ? { ...entry, showWhen: undefined } : entry) });
  };

  retype = (field, type) => {
    const meta = this.typeOf(type);
    this.changeField(field.uid, { type, options: [], optionsText: meta.choices && !field.optionsText ? 'Option 1\nOption 2' : field.optionsText, settings: {}, personal: ['email', 'tel'].includes(type) ? true : field.personal });
  };

  relabel = (field, label) => {
    this.changeField(field.uid, { label, ...(field.keyTouched ? {} : { key: this.freshKeyFor(field, label) }) });
  };

  freshKeyFor = (field, label) => {
    const stem = keyFrom(label) || 'field';
    let key = stem;
    for(let number = 2; this.draft.fields.some(other => other.uid !== field.uid && other.key === key); number++) key = `${stem}_${number}`.slice(0, 40);
    return key;
  };

  reorder = event => {
    const order = [...event.currentTarget.children].map(element => element.dataset.uid);
    const byUid = new Map(this.draft.fields.map(field => [field.uid, field]));
    const fields = order.map(id => byUid.get(id)).filter(Boolean);
    let removed = 0;
    const fixed = fields.map((field, index) => {
      if(field.showWhen && !fields.slice(0, index).some(earlier => earlier.key === field.showWhen.key)){
        removed++;
        return { ...field, showWhen: undefined };
      }
      return field;
    });
    this.draft = { ...this.draft, fields: fixed };
    // The sortable moved elements by hand; building the list again from the data keeps the page and the data agreeing.
    this.version++;
    if(removed) Toast.warning(`${plural(removed, 'condition')} removed: a field can only depend on one above it`);
  };

  conditionOperators = source => {
    if(!source) return [];
    if(source.type === 'checkbox' || source.type === 'toggle') return ['checked', 'not-checked'];
    if(source.type === 'checkboxes' || source.type === 'tags') return ['includes', 'empty', 'not-empty'];
    if(['file', 'image'].includes(source.type)) return ['empty', 'not-empty'];
    return ['equals', 'not-equals', 'empty', 'not-empty'];
  };

  setCondition = (field, changes) => {
    const current = field.showWhen || {};
    const next = { ...current, ...changes };
    if(!next.key){
      this.changeField(field.uid, { showWhen: undefined });
      return;
    }
    if('key' in changes){
      const source = this.draft.fields.find(entry => entry.key === next.key);
      next.operator = this.conditionOperators(source)[0];
      delete next.value;
    }
    if(['checked', 'not-checked', 'empty', 'not-empty'].includes(next.operator)) delete next.value;
    this.changeField(field.uid, { showWhen: next });
  };

  /*
    Saving
  */

  save = async () => {
    if(!this.draft.title.trim()) return Toast.error('Give the form a title first');
    if(this.form && this.draft.fields.length < this.form.fields.length){
      const gone = this.form.fields.filter(saved => !this.draft.fields.some(field => field.key === saved.key));
      if(gone.length && this.form.submissionCount){
        const agreed = await confirm(`${plural(this.form.submissionCount, 'submission')} already sent keep their answers to ${gone.map(field => `"${field.label}"`).join(', ')}. Removing a field only stops it being asked from now on.`, { title: 'Save without these fields?', yes: 'Save' });
        if(!agreed) return;
      }
    }

    this.saving = true;
    const [error, data] = this.formId ? await updateForm(this.formId, this.payload()) : await createForm(this.payload());
    this.saving = false;
    if(error) return Toast.error(error.msg);

    Toast.success('Form saved');
    if(!this.formId){
      this.saved = this.snapshot();
      location.replace(`/admin/extension/kempo-forms/form/?id=${encodeURIComponent(data.form.id)}`);
      return;
    }
    const [, again] = await getForm(this.formId);
    this.form = again?.form ?? data.form;
    this.adopt(this.form);
    this.version++;
  };

  setStatus = async status => {
    if(this.dirty && !(await confirm('You have changes that are not saved. Change the status anyway? Your changes stay on this page.', { title: 'Unsaved changes', yes: 'Continue' }))) return;
    if(status === 'archived' && !(await confirm(`"${this.form.title}" stops taking submissions and moves to the Trash. Its submissions are kept, and you can restore it from the Trash.`, { title: 'Archive this form?', yes: 'Archive' }))) return;
    const [error, data] = await setFormStatus(this.formId, status);
    if(error) return Toast.error(error.msg);
    if(status === 'archived'){
      Toast.success('Moved to the Trash');
      location.href = '/admin/extension/kempo-forms/';
      return;
    }
    this.form = { ...this.form, status: data.form.status };
    Toast.success(status === 'paused' ? 'Form paused' : 'Form is live');
  };

  duplicate = async () => {
    const [error, data] = await duplicateForm(this.formId);
    if(error) return Toast.error(error.msg);
    Toast.success('Copied. The copy is paused until you make it live');
    location.href = `/admin/extension/kempo-forms/form/?id=${encodeURIComponent(data.form.id)}`;
  };

  /*
    Rendering
  */

  #typeSettings(field){
    const settings = field.settings || {};
    const number = (name, label, hint) => html`<label class="d-b mb">${label}${hint ? html`<small class="d-b tc-muted">${hint}</small>` : nothing}
      <input type="number" .value=${settings[name] ?? ''} @input=${event => this.changeSetting(field, name, asNumber(event.target.value))}></label>`;
    const check = (name, label) => html`<label class="checkbox d-b mb"><input type="checkbox" .checked=${Boolean(settings[name])} @change=${event => this.changeSetting(field, name, event.target.checked || undefined)}> ${label}</label>`;

    switch(field.type){
      case 'number': return html`<div class="row"><div class="span-6 pr">${number('min', 'Smallest allowed')}</div><div class="span-6">${number('max', 'Largest allowed')}</div></div>`;
      case 'checkboxes': return number('maxItems', 'Most that can be chosen', 'Leave empty for no limit.');
      case 'tags': return html`${number('maxItems', 'Most tags', 'Leave empty to allow 20.')}${check('onlySuggestions', 'Only allow the suggestions above')}`;
      case 'slider': return html`<div class="row"><div class="span-6 pr">${number('min', 'Lowest value')}</div><div class="span-6">${number('max', 'Highest value')}</div></div>${check('range', 'Choose a range (two handles)')}`;
      case 'color': return check('allowAlpha', 'Allow transparency');
      case 'time': return number('increment', 'Minute step', 'For example 15 for quarter hours.');
      case 'date': return html`<div class="row"><div class="span-6 pr"><label class="d-b mb">Earliest date<input type="date" .value=${settings.min ?? ''} @input=${event => this.changeSetting(field, 'min', event.target.value)}></label></div><div class="span-6"><label class="d-b mb">Latest date<input type="date" .value=${settings.max ?? ''} @input=${event => this.changeSetting(field, 'max', event.target.value)}></label></div></div>`;
      case 'file':
      case 'image': return html`<label class="d-b mb">Accepted file types<small class="d-b tc-muted">Extensions separated by commas, such as pdf, png. Leave empty to accept any${field.type === 'image' ? ' image' : ''}.</small>
        <input type="text" .value=${(settings.accept || []).join(', ')} @input=${event => this.changeSetting(field, 'accept', event.target.value.split(',').map(item => item.trim()).filter(Boolean))}></label>${number('maxFiles', 'Most files', 'Limited by the site-wide setting.')}`;
      default: return nothing;
    }
  }

  #condition(field, index){
    const earlier = this.draft.fields.slice(0, index);
    const condition = field.showWhen;
    const source = condition ? earlier.find(entry => entry.key === condition.key) : null;
    const operators = this.conditionOperators(source);
    const needsValue = condition && ['equals', 'not-equals', 'includes'].includes(condition.operator);
    const choices = source ? textToOptions(source.optionsText || '') : [];

    return html`
      <label class="d-b mb">Show this field only when<small class="d-b tc-muted">Pick an earlier field, such as "How should we reach you?" to ask for a phone number only when Phone is chosen.</small></label>
      <div class="row">
        <div class="span-12 d-span-4 pr mb">
          <select aria-label="Field to look at" @change=${event => this.setCondition(field, { key: event.target.value })}>
            <option value="">Always show</option>
            ${earlier.map(entry => html`<option value=${entry.key} ?selected=${condition?.key === entry.key}>${entry.label}</option>`)}
          </select>
        </div>
        ${condition ? html`
          <div class="span-12 d-span-3 pr mb">
            <select aria-label="Comparison" @change=${event => this.setCondition(field, { operator: event.target.value })}>
              ${operators.map(operator => html`<option value=${operator} ?selected=${condition.operator === operator}>${OPERATOR_LABELS[operator]}</option>`)}
            </select>
          </div>
          ${needsValue ? html`<div class="span-12 d-span-5 mb">
            ${choices.length ? html`<select aria-label="Value" @change=${event => this.setCondition(field, { value: event.target.value })}>
              <option value="" ?selected=${!condition.value}>Choose…</option>
              ${choices.map(option => html`<option value=${option.value} ?selected=${condition.value === option.value}>${option.label}</option>`)}
            </select>` : html`<input type="text" aria-label="Value" .value=${condition.value ?? ''} @input=${event => this.setCondition(field, { value: event.target.value })}>`}
          </div>` : nothing}
        ` : nothing}
      </div>
    `;
  }

  #fieldEditor(field, index){
    const type = this.typeOf(field.type) || { label: field.type, choices: false, text: false };
    const takesOptions = ['select', 'combobox', 'radio', 'segmented', 'checkboxes', 'tags'].includes(field.type);

    return html`
      <div class="p">
        <div class="row">
          <label class="span-12 d-span-5 pr mb">Label<input type="text" .value=${field.label} @input=${event => this.relabel(field, event.target.value)}></label>
          <label class="span-12 d-span-4 pr mb">Type
            <select @change=${event => this.retype(field, event.target.value)}>
              ${this.meta.types.map(entry => html`<option value=${entry.key} ?selected=${entry.key === field.type}>${entry.label}</option>`)}
              ${this.meta.types.some(entry => entry.key === field.type) ? nothing : html`<option value=${field.type} selected>${type.label}</option>`}
            </select></label>
          <label class="span-12 d-span-3 mb">Key<small class="d-b tc-muted">What answers are saved under.</small>
            <input type="text" .value=${field.key} @input=${event => this.changeField(field.uid, { key: event.target.value, keyTouched: true })}></label>
        </div>
        <div class="row">
          <label class="span-12 d-span-6 pr mb">Hint<small class="d-b tc-muted">Shown under the label.</small>
            <input type="text" .value=${field.hint} @input=${event => this.changeField(field.uid, { hint: event.target.value })}></label>
          <label class="span-12 d-span-6 mb">Placeholder<small class="d-b tc-muted">Grey text inside an empty box.</small>
            <input type="text" .value=${field.placeholder} @input=${event => this.changeField(field.uid, { placeholder: event.target.value })}></label>
        </div>

        ${takesOptions ? html`<label class="d-b mb">Options<small class="d-b tc-muted">${field.type === 'tags' ? 'Suggestions, one per line.' : 'One per line. To save a different value from the one shown, write value | label.'}</small>
          <textarea rows="4" .value=${field.optionsText} @input=${event => this.changeField(field.uid, { optionsText: event.target.value })}></textarea></label>` : nothing}

        ${this.#typeSettings(field)}

        ${type.text && !type.rich ? html`<div class="row">
          <label class="span-6 d-span-3 pr mb">Shortest<input type="number" min="0" .value=${field.minLength ?? ''} @input=${event => this.changeField(field.uid, { minLength: asNumber(event.target.value) })}></label>
          <label class="span-6 d-span-3 pr mb">Longest<input type="number" min="0" .value=${field.maxLength ?? ''} @input=${event => this.changeField(field.uid, { maxLength: asNumber(event.target.value) })}></label>
          ${['text', 'textarea', 'email', 'tel'].includes(field.type) ? html`<label class="span-12 d-span-6 mb">Must match<small class="d-b tc-muted">A pattern the whole answer has to fit, such as [0-9]{5} for a zip code.</small>
            <input type="text" .value=${field.pattern ?? ''} @input=${event => this.changeField(field.uid, { pattern: event.target.value || undefined })}></label>` : nothing}
        </div>` : nothing}

        <label class="checkbox d-b mb"><input type="checkbox" .checked=${field.required} @change=${event => this.changeField(field.uid, { required: event.target.checked })}> Required</label>
        <label class="checkbox d-b mb"><input type="checkbox" .checked=${field.personal} @change=${event => this.changeField(field.uid, { personal: event.target.checked })}> Contains personal information<small class="d-b tc-muted">Erased from a submission when the person asks for their data to be deleted (CCPA or TCPA). The rest of the submission is kept.</small></label>

        ${index > 0 ? this.#condition(field, index) : nothing}

        <button class="danger" @click=${() => this.removeField(field)}><k-icon name="delete"></k-icon> Remove this field</button>
      </div>
    `;
  }

  #fieldsTab(){
    return html`
      <p class="tc-muted">Drag a field by its handle to change the order. Open a field to change it.</p>
      ${keyed(this.version, html`<k-sortable class="mb" @sort=${this.reorder}>
        ${repeat(this.draft.fields, field => field.uid, (field, index) => html`<k-sortable-item data-uid=${field.uid}>
          <k-accordion>
            <k-accordion-header for-panel=${`panel-${field.uid}`}>${field.label || 'Untitled field'}
              <small class="tc-muted"> · ${this.typeOf(field.type)?.label ?? field.type}${field.required ? ' · required' : ''}${field.showWhen ? ' · conditional' : ''}${field.personal ? ' · personal' : ''}</small></k-accordion-header>
            <k-accordion-panel name=${`panel-${field.uid}`}>${this.#fieldEditor(field, index)}</k-accordion-panel>
          </k-accordion>
        </k-sortable-item>`)}
      </k-sortable>`)}
      <div class="d-f mb">
        <select aria-label="Kind of field to add" class="mr">
          ${this.meta.types.map(type => html`<option value=${type.key}>${type.label}</option>`)}
        </select>
        <button @click=${this.addField}><k-icon name="add"></k-icon> Add field</button>
      </div>
      ${!this.meta.filesAvailable ? html`<p class="tc-muted">File and image fields appear here once kempo-files is installed.</p>` : nothing}
    `;
  }

  #formTab(){
    const draft = this.draft;
    return html`
      <div class="row">
        <div class="span-12 d-span-8">
          <label class="d-b mb">Title<small class="d-b tc-muted">Shown above the form, and used to find it here.</small>
            <input type="text" .value=${draft.title} @input=${event => {
              this.change({ title: event.target.value, ...(this.slugTouched ? {} : { slug: slugFrom(event.target.value) }) });
            }}></label>
          <label class="d-b mb">Address<small class="d-b tc-muted">The form is at ${this.meta.siteUrl}/forms/<strong>${draft.slug || 'address'}</strong> when its own page is on.</small>
            <input type="text" .value=${draft.slug} @input=${event => {
              this.slugTouched = true;
              this.change({ slug: event.target.value });
            }}></label>
          <label class="d-b mb">Introduction<small class="d-b tc-muted">Shown under the title.</small>
            <textarea rows="3" .value=${draft.description} @input=${event => this.change({ description: event.target.value })}></textarea></label>
          <label class="d-b mb">Submit button<input type="text" .value=${draft.submitLabel} @input=${event => this.change({ submitLabel: event.target.value })}></label>
          <label class="d-b mb">Message after sending<small class="d-b tc-muted">Shown in place of the form once it has been sent.</small>
            <textarea rows="3" .value=${draft.successMessage} @input=${event => this.change({ successMessage: event.target.value })}></textarea></label>
          <label class="d-b mb">Go to this address instead<small class="d-b tc-muted">Optional. A page on this site, such as /thanks, or a full web address. Replaces the message.</small>
            <input type="text" .value=${draft.redirectUrl} @input=${event => this.change({ redirectUrl: event.target.value })}></label>
          <label class="checkbox d-b mb"><input type="checkbox" .checked=${draft.standalonePage} @change=${event => this.change({ standalonePage: event.target.checked })}> Give the form a page of its own<small class="d-b tc-muted">Turn off if it is only used inside other pages.</small></label>
          <label class="d-b mb">Who can send it
            <select @change=${event => this.change({ accountRequirement: event.target.value })}>
              <option value="inherit" ?selected=${draft.accountRequirement === 'inherit'}>Follow the site setting</option>
              <option value="required" ?selected=${draft.accountRequirement === 'required'}>Only people who are signed in</option>
              <option value="optional" ?selected=${draft.accountRequirement === 'optional'}>Anyone</option>
            </select></label>
        </div>
      </div>
    `;
  }

  #notificationsTab(){
    const draft = this.draft;
    const emailFields = draft.fields.filter(field => field.type === 'email');
    return html`
      <div class="row">
        <div class="span-12 d-span-8">
          ${this.meta.emailNotifications ? nothing : html`<p class="tc-muted">Email notifications are off for the whole site, so nothing is emailed yet. Turn them on in <a href="/admin/extension/kempo-forms/#settings">Settings</a>. The addresses below are kept for when you do.</p>`}
          <label class="d-b mb">Email each submission to<small class="d-b tc-muted">Press Enter after each address.</small>
            <k-tags .value=${draft.notifyEmails.join(',')} @change=${event => this.change({ notifyEmails: event.target.value.split(',').map(address => address.trim()).filter(Boolean) })}></k-tags></label>
          <label class="checkbox d-b mb"><input type="checkbox" .checked=${draft.useDefaultRecipients} @change=${event => this.change({ useDefaultRecipients: event.target.checked })}> Also email the site-wide recipients<small class="d-b tc-muted">The addresses set under Settings.</small></label>

          <h3>Confirmation to the visitor</h3>
          <label class="checkbox d-b mb"><input type="checkbox" .checked=${draft.sendConfirmation} ?disabled=${!emailFields.length} @change=${event => this.change({ sendConfirmation: event.target.checked })}> Email the visitor to say it arrived<small class="d-b tc-muted">${emailFields.length ? 'Sent to the address they give.' : 'Add an email field first.'}</small></label>
          ${draft.sendConfirmation ? html`
            <label class="d-b mb">Which email field holds their address
              <select @change=${event => this.change({ confirmationField: event.target.value })}>
                <option value="" ?selected=${!draft.confirmationField}>Choose one</option>
                ${emailFields.map(field => html`<option value=${field.key} ?selected=${draft.confirmationField === field.key}>${field.label}</option>`)}
              </select></label>
            <label class="d-b mb">Subject<input type="text" .value=${draft.confirmationSubject} @input=${event => this.change({ confirmationSubject: event.target.value })}></label>
            <label class="d-b mb">Message<small class="d-b tc-muted">Added to the confirmation. Optional.</small>
              <textarea rows="4" .value=${draft.confirmationMessage} @input=${event => this.change({ confirmationMessage: event.target.value })}></textarea></label>
          ` : nothing}
        </div>
      </div>
    `;
  }

  #spamTab(){
    return html`
      <p class="tc-muted">A rule is a pattern checked against what people type. A submission that matches is kept as spam and not emailed (or refused, if the site setting says so). These rules apply to this form on top of the site-wide ones.</p>
      <k-forms-admin-rules .rules=${this.draft.spamRules} .fieldKeys=${this.draft.fields.map(field => field.key)} @change=${event => this.change({ spamRules: event.detail.rules })}></k-forms-admin-rules>
    `;
  }

  #placeTab(){
    const slug = this.draft.slug || 'address';
    const snippet = `<script type="module" src="/forms/components/Form.js"></script>\n<k-forms-form slug="${slug}"></k-forms-form>`;
    return html`
      <h3>On a page of its own</h3>
      ${this.draft.standalonePage ? html`<p><a href=${`/forms/${slug}`}>${this.meta.siteUrl}/forms/${slug}</a></p>` : html`<p class="tc-muted">The form's own page is turned off. Turn it on under Form.</p>`}
      <h3>Inside another page</h3>
      <p class="tc-muted">Put this where the form should appear.</p>
      <pre class="b r p mb"><code>${snippet}</code></pre>
      <button @click=${async () => {
        await navigator.clipboard.writeText(snippet);
        Toast.success('Copied');
      }}><k-icon name="copy"></k-icon> Copy</button>
      ${this.formId ? nothing : html`<p class="tc-muted mt">Save the form first so these work.</p>`}
    `;
  }

  render(){
    if(this.loading) return html`<k-spinner></k-spinner>`;
    if(this.error) return html`<p class="tc-danger" role="alert">${this.error}</p>`;

    const draft = this.draft;
    const status = this.form?.status;
    return html`
      <p><a href="/admin/extension/kempo-forms/"><k-icon name="arrow" rotation="180"></k-icon> All forms</a></p>
      <div class="d-f mb">
        <h1 class="flex m0">${draft.title || 'New form'}${status && status !== 'live' ? html` <small class="tc-muted">(${status === 'archived' ? 'in the Trash' : 'paused'})</small>` : nothing}</h1>
        ${this.canManage ? html`<div>
          ${this.formId && status !== 'archived' ? html`
            <button class="mr" @click=${() => this.setStatus(status === 'live' ? 'paused' : 'live')}><k-icon name=${status === 'live' ? 'pause' : 'play'}></k-icon> ${status === 'live' ? 'Pause' : 'Make live'}</button>
            <button class="mr" @click=${this.duplicate}><k-icon name="copy"></k-icon> Duplicate</button>
            <button class="mr" @click=${() => this.setStatus('archived')}><k-icon name="delete"></k-icon> Archive</button>
          ` : nothing}
          <button class="primary" ?disabled=${!this.dirty || this.saving} @click=${this.save}>${this.saving ? 'Saving…' : 'Save form'}</button>
        </div>` : nothing}
      </div>

      <k-tabs active="fields" hash-routing>
        <k-tab for="fields">Fields</k-tab>
        <k-tab for="form">Form</k-tab>
        <k-tab for="notifications">Notifications</k-tab>
        <k-tab for="spam">Spam</k-tab>
        <k-tab for="place">Place it</k-tab>
        <k-tab-content name="fields">${this.#fieldsTab()}</k-tab-content>
        <k-tab-content name="form">${this.#formTab()}</k-tab-content>
        <k-tab-content name="notifications">${this.#notificationsTab()}</k-tab-content>
        <k-tab-content name="spam">${this.#spamTab()}</k-tab-content>
        <k-tab-content name="place">${this.#placeTab()}</k-tab-content>
      </k-tabs>
      <slot name="panels"></slot>
    `;
  }
}

customElements.define('k-forms-admin-form', FormEditor);
