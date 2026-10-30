import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import '/kempo-ui/components/Accordion.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import './RuleEditor.js';
import { erasePerson, exportPersonUrl, findPerson, getSettings, saveSettings } from '/forms/sdk.js';
import { Toast, confirm, formatDate, plural } from './ui.js';
import permissions from './permissions.js';

/*
  The forms settings, grouped by what they decide. These are ordinary kempo settings and also appear on /admin/settings; this
  screen adds the grouping, the warnings, the spam rule editor, and validation that refuses a typo instead of quietly using the
  default. Each tab has its own Save and sends only the settings on it.

  The Privacy tab also holds the tool for a person's request about their data: find what they sent, give it to them, or erase
  the personal information from it.
*/

const LABELS = {
  site_url: 'Site address',
  default_recipients: 'Site-wide recipients',
  email_notifications: 'Email each new submission',
  require_account: 'Only signed-in people can send forms',
  rich_text: 'Formatted text in answers',
  max_field_length: 'Longest answer (characters)',
  spam_action: 'When a rule catches a submission',
  rate_limit_per_hour: 'Attempts one visitor can make in an hour',
  spam_rules: 'Site-wide spam rules',
  store_ip: 'Keep the visitor\'s IP address',
  trust_proxy: 'The site is behind my own proxy',
  retention_days: 'Delete submissions after (days)',
  spam_retention_days: 'Delete spam after (days)',
  upload_max_bytes: 'Largest file (MB)',
  upload_max_files: 'Most files in one submission',
};

const TABS = {
  general: ['site_url', 'default_recipients', 'email_notifications', 'require_account', 'rich_text', 'max_field_length'],
  spam: ['spam_action', 'rate_limit_per_hour', 'spam_rules'],
  privacy: ['store_ip', 'trust_proxy', 'retention_days', 'spam_retention_days'],
  files: ['upload_max_bytes', 'upload_max_files'],
};

const MB = 1048576;

export default class Settings extends ShadowComponent {
  static properties = {
    settings: { state: true },
    edits: { state: true },
    canEmail: { state: true },
    filesAvailable: { state: true },
    busy: { state: true },
    error: { state: true },
    canManage: { state: true },
  };

  constructor(){
    super();
    this.settings = [];
    this.edits = {};
    this.canEmail = false;
    this.filesAvailable = false;
    this.busy = false;
    this.error = '';
    this.canManage = false;
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    const pane = this.closest('k-tab-content');
    // Loads when its tab is first opened, and only for someone who can read the settings: the Forms page is for everyone.
    if(!pane || pane.active) this.load();
    else this.closest('k-tabs')?.addEventListener('tabfirstshown', ({ detail }) => {
      if(detail.tab === pane.name) this.load();
    });
  }

  /*
    Data
  */

  load = async () => {
    const granted = await permissions();
    if(!granted.has('forms:settings:manage')) return;
    this.canManage = granted.has('forms:submissions:manage');
    const [error, data] = await getSettings();
    this.error = error ? error.msg : '';
    this.settings = data?.settings || [];
    this.canEmail = Boolean(data?.canEmail);
    this.filesAvailable = Boolean(data?.filesAvailable);
    this.edits = {};
  };

  value = name => name in this.edits ? this.edits[name] : this.settings.find(setting => setting.name === name)?.value;

  set = (name, value) => {
    this.edits = { ...this.edits, [name]: value };
  };

  changed = names => names.some(name => name in this.edits);

  save = async names => {
    const changes = Object.fromEntries(names.filter(name => name in this.edits).map(name => [name, this.edits[name]]));
    if(!Object.keys(changes).length) return Toast.warning('Nothing has changed');
    this.busy = true;
    const [error] = await saveSettings(changes);
    this.busy = false;
    if(error) return Toast.error(error.msg);
    Toast.success('Settings saved');
    await this.load();
  };

  /*
    A person's data
  */

  /* Asks for the address in a dialog; once it is found, that dialog is replaced by the one that shows what is held. */
  find = () => {
    const label = document.createElement('label');
    label.htmlFor = 'forms-person';
    label.className = 'd-b mbq';
    label.textContent = 'Their email address';
    const input = document.createElement('input');
    input.id = 'forms-person';
    input.type = 'email';
    const content = document.createElement('div');
    content.className = 'p';
    content.append(label, input);

    Dialog.create(content, {
      title: 'Find a person\'s data',
      cancelText: 'Cancel',
      confirmText: 'Find',
      confirmClasses: 'primary ml',
      confirmAction: async event => {
        event.keepDialogOpen = true;
        const email = input.value.trim();
        if(!email) return Toast.warning('Enter the email address they used on a form');
        const [error, found] = await findPerson(email);
        if(error) return Toast.error(error.msg);
        this.showFound(email, found);
      },
    });
    input.focus();
  };

  showFound = (email, found) => {
    const erasable = found.total > 0 && this.canManage;
    Dialog.create(found.total ? html`
      <div class="p">
        <p>${plural(found.total, 'submission')} about ${email}:</p>
        <ul class="mb">${found.items.map(item => html`<li><a href=${`/admin/extension/kempo-forms/submission/?id=${encodeURIComponent(item.id)}`}>${item.formTitle}</a> · ${formatDate(item.createdAt)}</li>`)}</ul>
        <a class="btn" href=${exportPersonUrl(email)}><k-icon name="download"></k-icon> Download their data</a>
      </div>
    ` : html`<p class="p tc-muted">Nothing is held about that address.</p>`, {
      title: 'A person\'s data',
      cancelText: 'Close',
      ...(erasable ? { confirmText: 'Erase their personal information', confirmClasses: 'danger ml', confirmAction: event => {
        event.keepDialogOpen = true;
        this.erase(email, found);
      } } : {}),
    });
  };

  erase = async (email, found) => {
    const agreed = await confirm(
      `This erases the personal information (the fields marked personal) from ${plural(found.total, 'submission')} about ${email}. The rest of each submission is kept. This cannot be undone.\n\nEmails already delivered to your inbox, and backups of the database, are not changed.`,
      { title: 'Erase personal information', yes: 'Erase' },
    );
    if(!agreed) return this.showFound(email, found);
    const [error, result] = await erasePerson(email);
    if(error) return Toast.error(error.msg);
    Toast.success(`Erased from ${plural(result.matched, 'submission')}`);
  };

  /*
    Rendering
  */

  #number(name, { min = 0, scale = 1 } = {}){
    return html`<label class="d-b mb">${LABELS[name]}<small class="d-b tc-muted">${this.settings.find(setting => setting.name === name)?.description}</small>
      <input type="number" min=${min} step="1" .value=${String(Math.round(this.value(name) / scale * 100) / 100)} @input=${event => this.set(name, event.target.value === '' ? '' : Math.round(Number(event.target.value) * scale))}></label>`;
  }

  #text(name){
    return html`<label class="d-b mb">${LABELS[name]}<small class="d-b tc-muted">${this.settings.find(setting => setting.name === name)?.description}</small>
      <input type="text" .value=${this.value(name) ?? ''} @input=${event => this.set(name, event.target.value)}></label>`;
  }

  #check(name, { disabled = false, note = '' } = {}){
    return html`<label class="checkbox d-b mb"><input type="checkbox" .checked=${Boolean(this.value(name))} ?disabled=${disabled} @change=${event => this.set(name, event.target.checked)}> ${LABELS[name]}<small class="d-b tc-muted">${this.settings.find(setting => setting.name === name)?.description}${note ? ` ${note}` : ''}</small></label>`;
  }

  #choice(name, options){
    return html`<label class="d-b mb">${LABELS[name]}<small class="d-b tc-muted">${this.settings.find(setting => setting.name === name)?.description}</small>
      <select @change=${event => this.set(name, event.target.value)}>
        ${options.map(([value, label]) => html`<option value=${value} ?selected=${this.value(name) === value}>${label}</option>`)}
      </select></label>`;
  }

  #saveButton(tab){
    return html`<button class="primary" ?disabled=${this.busy || !this.changed(TABS[tab])} @click=${() => this.save(TABS[tab])}>${this.busy ? 'Saving…' : 'Save'}</button>`;
  }

  #person(){
    return html`
      <h3>A person's data</h3>
      <p class="tc-muted">When someone asks what you hold about them, or asks you to delete it, find them by the email address they used on a form. Erasing removes the fields marked personal and keeps the rest of each submission. It does not reach emails already delivered or backups.</p>
      <button @click=${this.find}><k-icon name="search"></k-icon> Find a person's data</button>
    `;
  }

  render(){
    if(!this.settings.length) return this.error ? html`<p class="tc-danger" role="alert">${this.error}</p>` : html`<k-spinner></k-spinner>`;

    return html`
      <k-accordion multiple>
        <k-accordion-header for-panel="general" active>General</k-accordion-header>
        <k-accordion-panel name="general" active>
          <div class="row m"><div class="span-12 d-span-8">
            ${this.#text('site_url')}
            ${this.#text('default_recipients')}
            ${this.#check('email_notifications', { disabled: !this.canEmail && !this.value('email_notifications'), note: this.canEmail ? '' : 'Install an email extension such as kempo-resend or kempo-smtp to turn this on.' })}
            ${this.#check('require_account')}
            ${this.#choice('rich_text', [['off', 'Not allowed'], ['markdown', 'Markdown'], ['html', 'Markdown and rich text']])}
            ${this.#number('max_field_length', { min: 1 })}
            ${this.#saveButton('general')}
          </div></div>
        </k-accordion-panel>

        <k-accordion-header for-panel="spam">Spam</k-accordion-header>
        <k-accordion-panel name="spam">
          <div class="row m"><div class="span-12 d-span-8">
            ${this.#choice('spam_action', [['spam', 'Keep it as spam, to review'], ['reject', 'Refuse it without saving']])}
            ${this.#number('rate_limit_per_hour')}
            <h3>${LABELS.spam_rules}</h3>
            <p class="tc-muted">A rule is a pattern checked against what people type, on every form. Each form can have rules of its own as well.</p>
            <k-forms-admin-rules .rules=${this.value('spam_rules')} @change=${event => this.set('spam_rules', event.detail.rules)}></k-forms-admin-rules>
            ${this.#saveButton('spam')}
          </div></div>
        </k-accordion-panel>

        <k-accordion-header for-panel="privacy">Privacy</k-accordion-header>
        <k-accordion-panel name="privacy">
          <div class="row m"><div class="span-12 d-span-8">
            ${this.#check('store_ip')}
            ${this.#check('trust_proxy')}
            ${this.#number('retention_days')}
            ${this.#number('spam_retention_days')}
            ${this.#saveButton('privacy')}
            ${this.#person()}
          </div></div>
        </k-accordion-panel>

        ${this.filesAvailable ? html`<k-accordion-header for-panel="files">Files</k-accordion-header>
        <k-accordion-panel name="files">
          <div class="row m"><div class="span-12 d-span-8">
            ${this.#number('upload_max_bytes', { min: 1, scale: MB })}
            ${this.#number('upload_max_files', { min: 1 })}
            ${this.#saveButton('files')}
          </div></div>
        </k-accordion-panel>` : nothing}
      </k-accordion>
      <slot name="sections"></slot>
    `;
  }
}

customElements.define('k-forms-admin-settings', Settings);
