import Form from '/forms/components/Form.js';
import { html } from '/kempo-ui/lit-all.min.js';

/*
  The Form widget as the page builder shows it: the form itself, drawn by the same component the page uses, so the fields,
  the heading and the button are what a visitor sees. It never sends: pressing the button does nothing here, and it does
  not read a form from the address of the editor. The form is looked up through the public form route, so a form that is
  not published (a draft, or one in the Trash) is not drawn, and the editor says so.
*/
export default class FormWidgetEditor extends Form {
  get editing(){
    return true;
  }

  render(){
    if(!this.slug) return html`<p class="tc-muted">Choose the form to show here in the settings.</p>`;
    if(this.phase === 'missing') return html`<p class="tc-muted">There is no published form with this address, so nothing will show here.</p>`;
    return super.render();
  }
}

customElements.define('k-forms-form-editor', FormWidgetEditor);
