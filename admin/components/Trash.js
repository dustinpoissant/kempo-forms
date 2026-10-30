import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import { emptyTrash, getTrash, previewEmptyTrash, setFormStatus } from '/forms/sdk.js';
import { Toast, confirm, formatDate, plural } from './ui.js';
import permissions from './permissions.js';

/*
  The Trash for forms. An archived form stops taking submissions and keeps everything. Restoring one brings it back paused, so it
  does not start taking submissions by surprise. Emptying the Trash removes the forms and every submission they have, files
  included, and cannot be undone. Trashed submissions are emptied from the Submissions screen.
*/
export default class AdminTrash extends ShadowComponent {
  static properties = {
    forms: { state: true },
    loading: { state: true },
    error: { state: true },
    canManage: { state: true },
  };

  constructor(){
    super();
    this.forms = [];
    this.loading = true;
    this.error = '';
    this.canManage = false;
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    const pane = this.closest('k-tab-content');
    // Loads when its tab is first opened, so a tab nobody opens makes no requests.
    if(!pane || pane.active) this.load();
    else this.closest('k-tabs')?.addEventListener('tabfirstshown', ({ detail }) => {
      if(detail.tab === pane.name) this.load();
    });
  }

  /*
    Data
  */

  load = async () => {
    this.loading = true;
    this.canManage = (await permissions()).has('forms:forms:manage');
    const [error, data] = await getTrash();
    this.loading = false;
    this.error = error ? error.msg : '';
    this.forms = data?.forms || [];
  };

  restore = async form => {
    const [error] = await setFormStatus(form.id, 'paused');
    if(error) return Toast.error(error.msg);
    Toast.success(`"${form.title}" is back, paused`);
    await this.load();
  };

  empty = async () => {
    const [previewError, preview] = await previewEmptyTrash();
    if(previewError) return Toast.error(previewError.msg);
    const agreed = await confirm(
      `This permanently deletes ${plural(preview.forms, 'form')} and ${plural(preview.submissions, 'submission')} that came in through ${preview.forms === 1 ? 'it' : 'them'}, with any files. This cannot be undone.`,
      { title: 'Empty the Trash', yes: 'Delete for good' },
    );
    if(!agreed) return;
    const [error, result] = await emptyTrash({ forms: true });
    if(error) return Toast.error(error.msg);
    Toast.success(`Deleted ${plural(result.forms, 'form')} and ${plural(result.submissions, 'submission')}`);
    await this.load();
  };

  /*
    Rendering
  */

  render(){
    if(this.loading && !this.forms.length) return html`<k-spinner></k-spinner>`;
    if(this.error) return html`<p class="tc-danger" role="alert">${this.error}</p>`;
    if(!this.forms.length) return html`<p class="tc-muted">The Trash is empty. A form you archive waits here until you empty it.</p>`;

    return html`
      <p class="tc-muted">Archived forms keep their submissions. Restoring a form brings it back paused. Emptying the Trash removes these forms and their submissions for good.</p>
      <table class="mb">
        <tr><th>Form</th><th>Archived</th><th>Submissions</th><th></th></tr>
        ${this.forms.map(form => html`<tr>
          <td>${form.title}<small class="d-b tc-muted">/forms/${form.slug}</small></td>
          <td>${formatDate(form.archivedAt)}</td>
          <td>${form.submissionCount + form.trashedCount}</td>
          <td class="ta-right">${this.canManage ? html`<button @click=${() => this.restore(form)}><k-icon name="replay"></k-icon> Restore</button>` : nothing}</td>
        </tr>`)}
      </table>
      ${this.canManage ? html`<button class="danger" @click=${this.empty}><k-icon name="delete_sweep"></k-icon> Empty the Trash</button>` : nothing}
    `;
  }
}

customElements.define('k-forms-admin-trash', AdminTrash);
