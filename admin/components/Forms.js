import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Spinner.js';
import '/kempo-ui/components/Table.js';
import '/kempo-ui/components/controls/TcOpen.js';
import '/kempo-ui/components/controls/TcSearch.js';
import '/kempo-ui/components/controls/TcFilters.js';
import '/kempo-ui/components/controls/TcFieldSortHide.js';
import '/kempo-ui/components/controls/TcFirstPage.js';
import '/kempo-ui/components/controls/TcPrevPage.js';
import '/kempo-ui/components/controls/TcNextPage.js';
import '/kempo-ui/components/controls/TcLastPage.js';
import '/kempo-ui/components/controls/TcPageSelect.js';
import '/kempo-ui/components/controls/TcPageSize.js';
import { listForms } from '/forms/sdk.js';
import { formatDate, STATUS_LABELS } from './ui.js';

/*
  The forms list. The table does the searching, filtering, sorting and field choice itself, as the products list does, so every
  form is loaded (200 at a time) and the table's own controls work on all of them. Opening a form goes to its own page.
*/
export default class AdminForms extends ShadowComponent {
  static properties = {
    loading: { state: true },
    error: { state: true },
  };

  constructor(){
    super();
    this.loading = true;
    this.error = '';
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

  record = form => ({
    ...form,
    addressText: `/forms/${form.slug}`,
    statusText: STATUS_LABELS[form.status] ?? form.status,
    submissionsText: `${form.submissionCount}${form.newCount ? ` · ${form.newCount} new` : ''}`,
    _url: `/admin/extension/kempo-forms/form/?id=${encodeURIComponent(form.id)}`,
  });

  load = async () => {
    await this.updateComplete;
    const $table = this.renderRoot.querySelector('k-table');
    this.loading = true;
    const forms = [];
    for(let offset = 0; ; offset += 200){
      const [error, page] = await listForms({ limit: 200, offset });
      if(error){
        this.loading = false;
        this.error = error.msg;
        return;
      }
      forms.push(...page.items);
      if(!page.items.length || forms.length >= page.total) break;
    }
    this.loading = false;
    this.error = '';
    $table.setData({
      records: forms.map(this.record),
      fields: [
        { name: 'title', label: 'Form', editable: false },
        { name: 'addressText', label: 'Address', size: 200, editable: false },
        { name: 'statusText', label: 'Status', size: 110, editable: false },
        { name: 'submissionsText', label: 'Submissions', size: 160, editable: false },
        { name: 'lastSubmissionAt', label: 'Last submission', size: 190, editable: false, formatter: formatDate },
      ],
    });
  };

  /*
    Rendering
  */

  render(){
    return html`
      ${this.error ? html`<p class="tc-danger" role="alert">${this.error}</p>` : nothing}
      ${this.loading ? html`<k-spinner></k-spinner>` : nothing}

      <k-table open-on-click enable-pages page-size="25" page-size-options="[10,25,50]" placeholder="No forms yet." filtered-placeholder="No forms match your search.">
        <div slot="top" class="d-f full" style="align-items: center; gap: var(--spacer_h); flex-wrap: wrap;">
          <kc-tc-search style="width: 16rem"></kc-tc-search>
          <kc-tc-filters></kc-tc-filters>
          <kc-tc-field-sort-hide></kc-tc-field-sort-hide>
          <div class="flex"></div>
          <k-permission has="forms:forms:manage">
            <a href="/admin/extension/kempo-forms/form/" class="btn primary" id="newFormBtn"><k-icon name="add"></k-icon> New form</a>
          </k-permission>
        </div>
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

customElements.define('k-forms-admin-forms', AdminForms);
