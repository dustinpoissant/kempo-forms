import ButtonControl from '/kempo-ui/components/controls/ButtonControl.js';
import { html } from '/kempo-ui/lit-all.min.js';
import Dialog from '/kempo-ui/components/Dialog.js';
import Toast from '/kempo-ui/components/Toast.js';
import '/kempo-ui/components/Icon.js';
import { listForms } from '/forms/sdk.js';

/*
  The toolbar button of the content editor that places a form in the page. It asks which form, then adds the form's card (see
  FormNode.js, loaded only now so the editor's CDN copy of Lexical is not fetched on every admin page).
*/
export default class InsertForm extends ButtonControl {
  static hostMode = 'visual';

  connectedCallback(){
    super.connectedCallback();
    if(!this.hasAttribute('title')) this.title = 'Insert a form';
  }

  handleAction = async () => {
    const host = this.host;
    if(!host) return;
    const [error, data] = await listForms({ limit: 200 });
    if(error){
      Toast.error(error.msg || 'The forms could not be loaded');
      return;
    }
    if(!data.items.length){
      Toast.error('There are no forms yet. Make one on the Forms page first.');
      return;
    }

    const select = document.createElement('select');
    select.id = 'kempo-forms-insert-form';
    for(const form of data.items){
      const option = document.createElement('option');
      option.value = form.slug;
      option.textContent = `${form.title} (/forms/${form.slug})`;
      select.append(option);
    }
    const label = document.createElement('label');
    label.htmlFor = select.id;
    label.className = 'd-b mbq';
    label.textContent = 'Form';
    const content = document.createElement('div');
    content.className = 'p';
    content.append(label, select);

    Dialog.create(content, {
      title: 'Insert a form',
      cancelText: 'Cancel',
      confirmText: 'Insert form',
      confirmClasses: 'primary',
      confirmAction: async () => (await import('./FormNode.js')).insertFormNode(host.lexicalEditor, select.value),
    });
  };

  render(){
    return html`<k-icon src="/forms/icons/assignment.svg"></k-icon>`;
  }
}

customElements.define('kc-forms-insert-form', InsertForm);
