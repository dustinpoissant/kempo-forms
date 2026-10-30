import DashboardWidget from '/kempo/components/DashboardWidget.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import { getSummary } from '/forms/sdk.js';

/*
  The dashboard's view of the forms: how many submissions came in today and this week, how many nobody has read yet, and the
  spam waiting for someone to confirm it really is spam.
*/
export default class FormsWidget extends DashboardWidget {
  static properties = {
    ...DashboardWidget.properties,
    summary: { state: true },
  };

  constructor(){
    super();
    this.summary = null;
    this.cta = { label: 'View submissions', iconSrc: '/forms/icons/forms.svg', href: '/admin/extension/kempo-forms/submissions/' };
  }

  /*
    Public Methods
  */

  load = async () => {
    this.summary = await this.unwrap(getSummary());
  };

  /*
    Rendering
  */

  renderContent(){
    const { today, week, unread, spam } = this.summary;

    return html`
      <div class="d-f mb">
        <div class="flex"><div class="h2 m0">${today}</div><div class="tc-muted">Today</div></div>
        <div class="flex"><div class="h2 m0">${week}</div><div class="tc-muted">This week</div></div>
        <div class="flex"><div class="h2 m0">${unread}</div><div class="tc-muted">Unread</div></div>
      </div>
      ${spam ? html`<p class="tc-muted m0">${spam} possible spam waiting for review.</p>` : nothing}
    `;
  }
}

customElements.define('k-forms-widget', FormsWidget);
