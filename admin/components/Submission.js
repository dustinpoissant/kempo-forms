import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, nothing, unsafeHTML } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import { addNote, getSubmission, resendNotification, restoreSubmissions, setSubmissionStatus, trashSubmissions } from '/forms/sdk.js';
import { Toast, confirm, formatDate } from './ui.js';
import permissions from './permissions.js';

/*
  One submission, a page of its own (?id=): what was sent with each answer under its label, the spam verdicts that touched it,
  the history of everything that happened to it, and what a person can do with it. A new submission is marked read when it is
  opened by someone who is allowed to, as in a mail client.

  Answers from formatted fields arrive already cleaned by the server, which is why they are inserted as HTML; everything else
  arrives as escaped text.
*/

const STATUS = { new: 'New', read: 'Read', spam: 'Spam', trashed: 'In the Trash' };

const describe = event => {
  const data = event.data || {};
  switch(event.type){
    case 'created': return 'Received';
    case 'read': return 'Marked read';
    case 'status_changed': return `Changed from ${STATUS[data.from] || data.from} to ${STATUS[data.to] || data.to}${data.reason ? ` (${data.reason})` : ''}`;
    case 'note': return data.text ? `Note: ${data.text}` : 'A note (erased)';
    case 'data_set': return `An extension saved "${data.key}"`;
    case 'notified': return data.ok ? `Emailed ${data.recipient}` : `Could not email${data.recipient ? ` ${data.recipient}` : ''}: ${data.error || 'unknown reason'}`;
    case 'confirmation': return data.ok ? 'Confirmation sent to the visitor' : `The confirmation to the visitor was not sent: ${data.error || 'unknown reason'}`;
    case 'erased': return `Personal information erased (${(data.keys || []).length} field${(data.keys || []).length === 1 ? '' : 's'})`;
    case 'trashed': return 'Moved to the Trash';
    case 'restored': return 'Restored from the Trash';
    case 'form_archived': return 'The form was archived';
    default: return event.type;
  }
};

export default class AdminSubmission extends ShadowComponent {
  static properties = {
    submission: { state: true },
    files: { state: true },
    loading: { state: true },
    error: { state: true },
    note: { state: true },
    canManage: { state: true },
  };

  constructor(){
    super();
    this.submission = null;
    this.files = [];
    this.loading = true;
    this.error = '';
    this.note = '';
    this.canManage = false;
    this.submissionId = new URLSearchParams(location.search).get('id') || '';
  }

  /*
    Lifecycle
  */

  connectedCallback(){
    super.connectedCallback();
    this.load();
  }

  /*
    Data
  */

  load = async () => {
    this.canManage = (await permissions()).has('forms:submissions:manage');
    const [error, data] = await getSubmission(this.submissionId);
    this.loading = false;
    if(error){
      this.error = error.msg;
      return;
    }
    this.submission = data.submission;
    this.files = data.files;
    if(this.canManage && data.submission.status === 'new'){
      const [markError] = await setSubmissionStatus([this.submissionId], 'read');
      if(!markError) this.submission = { ...this.submission, status: 'read' };
    }
  };

  setStatus = async (status, message, reason = '') => {
    const [error] = await setSubmissionStatus([this.submissionId], status, reason);
    if(error) return Toast.error(error.msg);
    Toast.success(message);
    await this.load();
  };

  trash = async () => {
    const [error] = await trashSubmissions([this.submissionId]);
    if(error) return Toast.error(error.msg);
    Toast.success('Moved to the Trash');
    await this.load();
  };

  restore = async () => {
    const [error] = await restoreSubmissions([this.submissionId]);
    if(error) return Toast.error(error.msg);
    Toast.success('Restored');
    await this.load();
  };

  resend = async () => {
    const agreed = await confirm('Email this submission to its recipients again?', { title: 'Send again', yes: 'Send' });
    if(!agreed) return;
    const [error, result] = await resendNotification(this.submissionId);
    if(error) return Toast.error(error.msg);
    result.skipped ? Toast.warning('Nobody to send it to') : Toast.success(`Sent to ${result.sent}${result.failed ? `, ${result.failed} failed` : ''}`);
    await this.load();
  };

  addNote = async event => {
    event.preventDefault();
    const [error] = await addNote(this.submissionId, this.note);
    if(error) return Toast.error(error.msg);
    this.note = '';
    Toast.success('Note added');
    await this.load();
  };

  /*
    Rendering
  */

  #answers(){
    const { rows, schema, erasedAt } = this.submission;
    const erased = schema.filter(field => field.erased && !rows.some(row => row.key === field.key));
    return html`
      <table class="mb">
        ${rows.map(row => html`<tr><th scope="row">${row.label}</th><td>${['file', 'image'].includes(row.type)
          ? (this.files.length ? this.files.map(file => html`<a class="d-b" href=${file.url}>${file.name}</a>`) : row.text)
          : unsafeHTML(row.html)}</td></tr>`)}
        ${erased.map(field => html`<tr><th scope="row">${field.label}</th><td class="tc-muted">Erased ${formatDate(erasedAt)}</td></tr>`)}
        ${rows.length || erased.length ? nothing : html`<tr><td class="tc-muted">Nothing was filled in.</td></tr>`}
      </table>
    `;
  }

  #actions(){
    if(!this.canManage) return nothing;
    const { status } = this.submission;
    if(status === 'trashed') return html`<button @click=${this.restore}><k-icon name="replay"></k-icon> Restore</button>`;
    return html`
      ${status === 'read' ? html`<button class="mr mb" @click=${() => this.setStatus('new', 'Marked unread')}><k-icon name="visibility"></k-icon> Mark unread</button>` : nothing}
      ${status === 'spam'
        ? html`<button class="mr mb" @click=${() => this.setStatus('new', 'Moved out of spam', 'Not spam')}><k-icon name="check"></k-icon> This is not spam</button>`
        : html`<button class="mr mb" @click=${() => this.setStatus('spam', 'Marked as spam', 'Marked as spam')}><k-icon name="warning"></k-icon> This is spam</button>`}
      ${status === 'spam' ? nothing : html`<button class="mr mb" @click=${this.resend}><k-icon name="send"></k-icon> Email it again</button>`}
      <button class="danger mb" @click=${this.trash}><k-icon name="delete"></k-icon> Move to the Trash</button>`;
  }

  render(){
    if(this.loading) return html`<k-spinner></k-spinner>`;
    if(this.error) return html`<p class="tc-danger" role="alert">${this.error}</p>`;

    const submission = this.submission;
    return html`
      <p><a href="/admin/extension/kempo-forms/submissions/"><k-icon name="arrow" rotation="180"></k-icon> All submissions</a></p>
      <h1 class="m0">${submission.formTitle}</h1>
      <p class="tc-muted mb">Received ${formatDate(submission.createdAt)} · ${STATUS[submission.status]}${submission.erasedAt ? ' · personal information erased' : ''}</p>

      <div class="mb">${this.#actions()}</div>

      <div class="row">
        <div class="span-12 d-span-8 pr">
          <h3>What was sent</h3>
          ${this.#answers()}

          <h3>History</h3>
          <ul class="mb">
            ${submission.events.map(event => html`<li>${describe(event)}<small class="tc-muted"> · ${formatDate(event.at)}${event.actor ? ` · ${event.actor}` : ''}</small></li>`)}
          </ul>
          ${this.canManage ? html`<form @submit=${this.addNote} class="mb">
            <label class="d-b mbq" for="note">Add a note<small class="d-b tc-muted">Only people who manage submissions see notes.</small></label>
            <textarea id="note" rows="3" class="mb" .value=${this.note} @input=${event => {
              this.note = event.target.value;
            }}></textarea>
            <button type="submit" ?disabled=${!this.note.trim()}>Add note</button>
          </form>` : nothing}
        </div>

        <div class="span-12 d-span-4">
          <h3>Spam check</h3>
          ${submission.spam.length ? html`<ul class="mb">${submission.spam.map(verdict => html`<li>${verdict.source}: ${verdict.action}${verdict.reason ? html`<small class="d-b tc-muted">${verdict.reason}</small>` : nothing}${verdict.score !== undefined ? html`<small class="d-b tc-muted">Score ${verdict.score}</small>` : nothing}</li>`)}</ul>`
            : html`<p class="tc-muted">Nothing flagged it.</p>`}

          <h3>Sent from</h3>
          <p class="tc-muted mb">${submission.userId ? 'A signed-in user' : 'Not signed in'}${submission.ip ? ` · ${submission.ip}` : ''}${submission.userAgent ? html`<small class="d-b">${submission.userAgent}</small>` : nothing}</p>
        </div>
      </div>

      <slot name="panels"></slot>
      <slot name="actions"></slot>
    `;
  }
}

customElements.define('k-forms-admin-submission', AdminSubmission);
