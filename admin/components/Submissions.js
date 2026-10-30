import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import '/kempo-ui/components/Table.js';
import '/kempo-ui/components/SegmentedControl.js';
import '/kempo-ui/components/controls/TcOpen.js';
import '/kempo-ui/components/controls/TcFirstPage.js';
import '/kempo-ui/components/controls/TcPrevPage.js';
import '/kempo-ui/components/controls/TcNextPage.js';
import '/kempo-ui/components/controls/TcLastPage.js';
import '/kempo-ui/components/controls/TcPageSelect.js';
import '/kempo-ui/components/controls/TcPageSize.js';
import { countSubmissions, emptyTrash, exportUrl, listSubmissionForms, listSubmissions, restoreSubmissions, setSubmissionStatus, trashSubmissions } from '/forms/sdk.js';
import { Toast, confirm, formatDate, plural } from './ui.js';
import permissions from './permissions.js';

/*
  Every submission, newest first. The choices above the table are the tabs of the plan: New (not read yet), All (everything but
  spam and the Trash), Spam (what a rule or an extension flagged, for a person to confirm) and Trash. Opening a submission goes
  to its own page. Rows can be ticked to mark them read, flag or clear spam, or move them to the Trash and back.
*/

const SUMMARY_LENGTH = 140;

const summaryOf = submission => {
  const parts = [];
  for(const field of submission.schema){
    const value = submission.values[field.key];
    if(value === undefined || value === null || value === '' || ['markdown', 'richtext', 'file', 'image'].includes(field.type)) continue;
    parts.push(Array.isArray(value) ? value.join(', ') : String(value));
    if(parts.join(' · ').length > SUMMARY_LENGTH) break;
  }
  const text = parts.join(' · ');
  return text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH)}…` : text;
};

export default class AdminSubmissions extends ShadowComponent {
  static properties = {
    tab: { state: true },
    counts: { state: true },
    forms: { state: true },
    loading: { state: true },
    error: { state: true },
    search: { state: true },
    form: { state: true },
    from: { state: true },
    to: { state: true },
    selected: { state: true },
    canManage: { state: true },
  };

  constructor(){
    super();
    const params = new URLSearchParams(location.search);
    this.tab = params.get('tab') ?? 'new';
    this.counts = { new: 0, read: 0, spam: 0, trashed: 0 };
    this.forms = [];
    this.loading = true;
    this.error = '';
    this.search = params.get('search') ?? '';
    this.form = params.get('form') ?? '';
    this.from = params.get('from') ?? '';
    this.to = params.get('to') ?? '';
    this.selected = 0;
    this.canManage = false;
    this.timer = null;
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    this.start();
  }

  start = async () => {
    this.canManage = (await permissions()).has('forms:submissions:manage');
    const [, data] = await listSubmissionForms();
    this.forms = data?.forms || [];
    await this.load();
  };

  /*
    Data
  */

  /* The filters as the API takes them. The New tab is a status of its own; All is "no status". */
  filters = () => ({ form: this.form, status: this.tab === 'all' ? '' : (this.tab === 'trash' ? 'trashed' : this.tab), search: this.search, from: this.from, to: this.to });

  record = submission => ({
    ...submission,
    summary: summaryOf(submission),
    _url: `/admin/extension/kempo-forms/submission/?id=${encodeURIComponent(submission.id)}`,
  });

  load = async () => {
    await this.updateComplete;
    const $table = this.renderRoot.querySelector('k-table');
    this.loading = true;
    const [[error, data], [, counts]] = await Promise.all([listSubmissions({ ...this.filters(), limit: 25, offset: 0 }), countSubmissions({ form: this.form })]);
    this.loading = false;
    if(counts) this.counts = counts.counts;
    if(error){
      this.error = error.msg;
      return;
    }
    this.error = '';
    this.selected = 0;
    $table.setData({
      records: data.items.map(this.record),
      fields: [
        { name: 'createdAt', label: 'Received', size: 180, editable: false, formatter: formatDate },
        { name: 'formTitle', label: 'Form', size: 180, editable: false },
        { name: 'summary', label: 'What was sent', editable: false },
        { name: 'status', label: 'Status', size: 90, editable: false, calculator: submission => ({ new: 'New', read: 'Read', spam: 'Spam', trashed: 'Trash' })[submission.status] },
      ],
    });
    $table.setupFetchRecords(data.total, async (start, count) => {
      const [fetchError, page] = await listSubmissions({ ...this.filters(), limit: count, offset: start });
      return fetchError ? [] : page.items.map(this.record);
    });
    const params = new URLSearchParams();
    for(const [name, value] of Object.entries({ ...this.filters(), tab: this.tab === 'new' ? '' : this.tab, status: '' })){
      if(value) params.set(name, value);
    }
    history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  };

  change = (name, event) => {
    this[name] = event.target.value;
    clearTimeout(this.timer);
    this.timer = setTimeout(this.load, name === 'search' ? 300 : 0);
  };

  switchTab = event => {
    this.tab = event.target.value;
    this.load();
  };

  /*
    Actions on the ticked rows
  */

  chosen = () => this.renderRoot.querySelector('k-table')?.getSelectedRecords?.().map(record => record.id) ?? [];

  act = async (run, done) => {
    const ids = this.chosen();
    if(!ids.length) return Toast.error('Tick at least one submission first');
    const [error] = await run(ids);
    if(error) return Toast.error(error.msg);
    Toast.success(done(ids.length));
    await this.load();
  };

  emptyTheTrash = async () => {
    const agreed = await confirm(`This permanently deletes the ${plural(this.counts.trashed, 'submission')} in the Trash, with their files and history. This cannot be undone.`, { title: 'Empty the Trash', yes: 'Delete for good' });
    if(!agreed) return;
    const [error, result] = await emptyTrash({ submissions: true });
    if(error) return Toast.error(error.msg);
    Toast.success(`Deleted ${plural(result.submissions, 'submission')}`);
    await this.load();
  };

  /*
    Rendering
  */

  #actions(){
    if(!this.canManage) return nothing;
    if(this.tab === 'trash') return html`
      <button class="mr mb" @click=${() => this.act(restoreSubmissions, count => `Restored ${plural(count, 'submission')}`)}><k-icon name="replay"></k-icon> Restore</button>
      <button class="danger mb" ?disabled=${!this.counts.trashed} @click=${this.emptyTheTrash}><k-icon name="delete_sweep"></k-icon> Empty the Trash</button>`;
    return html`
      <button class="mr mb" @click=${() => this.act(ids => setSubmissionStatus(ids, 'read'), count => `Marked ${plural(count, 'submission')} read`)}><k-icon name="done_all"></k-icon> Mark read</button>
      ${this.tab === 'spam'
        ? html`<button class="mr mb" @click=${() => this.act(ids => setSubmissionStatus(ids, 'new', 'Not spam'), count => `${plural(count, 'submission')} moved out of spam`)}><k-icon name="check"></k-icon> Not spam</button>`
        : html`<button class="mr mb" @click=${() => this.act(ids => setSubmissionStatus(ids, 'spam', 'Marked as spam'), count => `Marked ${plural(count, 'submission')} as spam`)}><k-icon name="warning"></k-icon> This is spam</button>`}
      <button class="danger mb" @click=${() => this.act(trashSubmissions, count => `Moved ${plural(count, 'submission')} to the Trash`)}><k-icon name="delete"></k-icon> Move to the Trash</button>`;
  }

  render(){
    const label = (text, count) => count ? `${text} (${count})` : text;
    return html`
      <k-segmented-control class="mb" .value=${this.tab} @change=${this.switchTab}>
        <k-sc-option value="new">${label('New', this.counts.new)}</k-sc-option>
        <k-sc-option value="all">${label('All', this.counts.new + this.counts.read)}</k-sc-option>
        <k-sc-option value="spam">${label('Spam', this.counts.spam)}</k-sc-option>
        <k-sc-option value="trash">${label('Trash', this.counts.trashed)}</k-sc-option>
      </k-segmented-control>

      <div class="row">
        <label class="span-12 d-span-3 pr mb">Form<small class="tc-muted d-b">&nbsp;</small>
          <select @change=${event => this.change('form', event)}>
            <option value="">Every form</option>
            ${this.forms.map(form => html`<option value=${form.id} ?selected=${this.form === form.id}>${form.title}</option>`)}
          </select></label>
        <label class="span-12 d-span-3 pr mb">Search<small class="tc-muted d-b">What was sent, or the form's title</small>
          <input type="search" .value=${this.search} @input=${event => this.change('search', event)}></label>
        <label class="span-6 d-span-2 pr mb">From<small class="tc-muted d-b">&nbsp;</small><input type="date" .value=${this.from} @change=${event => this.change('from', event)}></label>
        <label class="span-6 d-span-2 pr mb">To<small class="tc-muted d-b">&nbsp;</small><input type="date" .value=${this.to} @change=${event => this.change('to', event)}></label>
        <div class="span-12 d-span-2 mb"><small class="d-b">&nbsp;</small><span class="d-b">&nbsp;</span><a class="btn" href=${exportUrl(this.filters())}><k-icon name="download"></k-icon> Export</a></div>
      </div>

      ${this.#actions()}
      ${this.error ? html`<p class="tc-danger" role="alert">${this.error}</p>` : nothing}
      ${this.loading ? html`<k-spinner></k-spinner>` : nothing}

      <k-table open-on-click enable-selection enable-pages page-size="25" page-size-options="[10,25,50]" placeholder="Nothing here." @selectionChange=${() => {
        this.selected = this.chosen().length;
      }}>
        <kc-tc-open slot="before"></kc-tc-open>
        <div class="d-f full" style="align-items: center;">
          <div>
            <kc-tc-first-page></kc-tc-first-page>
            <kc-tc-prev-page></kc-tc-prev-page>
            <kc-tc-next-page></kc-tc-next-page>
            <kc-tc-last-page></kc-tc-last-page>
          </div>
          <div class="flex"></div>
          <div><kc-tc-page-select></kc-tc-page-select></div>
          <div class="flex"></div>
          <div><kc-tc-page-size></kc-tc-page-size></div>
        </div>
      </k-table>
    `;
  }
}

customElements.define('k-forms-admin-submissions', AdminSubmissions);
