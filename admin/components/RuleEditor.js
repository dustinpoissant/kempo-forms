import ShadowComponent from '/kempo-ui/components/ShadowComponent.js';
import { html, nothing } from '/kempo-ui/lit-all.min.js';
import '/kempo-ui/components/Icon.js';
import '/kempo-ui/components/Tags.js';
import { testRules } from '/forms/sdk.js';
import { Toast } from './ui.js';

/*
  The editor for a list of spam rules, used for the site-wide list in the settings and for each form's own list. A rule is a name,
  a pattern, whether capital letters matter, and optionally the fields it looks at. Under the list, a tester shows which rules
  match some text without saving or sending anything.

  Set `rules` (the list) and `field-keys` (the keys a rule can be limited to; leave it out to let the rule name any). It fires
  `change` with { rules } every time the list changes, and holds no copy the page does not also have.
*/
export default class RuleEditor extends ShadowComponent {
  static properties = {
    rules: { type: Array },
    fieldKeys: { type: Array },
    sample: { state: true },
    result: { state: true },
  };

  constructor(){
    super();
    this.rules = [];
    this.fieldKeys = null;
    this.sample = '';
    this.result = null;
  }

  /*
    Actions
  */

  emit = rules => {
    this.rules = rules;
    this.result = null;
    this.dispatchEvent(new CustomEvent('change', { detail: { rules }, bubbles: true }));
  };

  add = () => this.emit([...this.rules, { name: '', pattern: '', flags: 'i', fields: 'all' }]);

  edit = (index, changes) => this.emit(this.rules.map((rule, at) => at === index ? { ...rule, ...changes } : rule));

  remove = index => this.emit(this.rules.filter((rule, at) => at !== index));

  test = async () => {
    const [error, result] = await testRules(this.rules, this.sample);
    if(error) return Toast.error(error.msg);
    this.result = result.matched;
  };

  /*
    Rendering
  */

  render(){
    return html`
      ${this.rules.map((rule, index) => html`<div class="b r p mb">
        <div class="row">
          <label class="span-12 d-span-4 pr mb">Name<input type="text" .value=${rule.name} @input=${event => this.edit(index, { name: event.target.value })}></label>
          <label class="span-12 d-span-8 mb">Pattern<small class="d-b tc-muted">For example bitcoin|crypto. Lookahead and backreferences are not supported.</small>
            <input type="text" .value=${rule.pattern} @input=${event => this.edit(index, { pattern: event.target.value })}></label>
        </div>
        <label class="checkbox d-b mb"><input type="checkbox" .checked=${rule.flags.includes('i')} @change=${event => this.edit(index, { flags: `${event.target.checked ? 'i' : ''}${rule.flags.includes('m') ? 'm' : ''}` })}> Ignore capital letters</label>
        <label class="d-b mb">Only these fields<small class="d-b tc-muted">Leave empty to check every field.</small>
          <k-tags allowed-tags=${this.fieldKeys ? this.fieldKeys.join(',') : ''} .value=${rule.fields === 'all' ? '' : rule.fields.join(',')}
            @change=${event => this.edit(index, { fields: event.target.value ? event.target.value.split(',').map(key => key.trim()).filter(Boolean) : 'all' })}></k-tags></label>
        <button class="danger" @click=${() => this.remove(index)}><k-icon name="delete"></k-icon> Remove this rule</button>
      </div>`)}
      <button class="mb" @click=${this.add}><k-icon name="add"></k-icon> Add a rule</button>

      <h4>Try the rules</h4>
      <label class="d-b mb">Some text<small class="d-b tc-muted">Nothing is saved or sent.</small>
        <textarea rows="3" .value=${this.sample} @input=${event => {
          this.sample = event.target.value;
          this.result = null;
        }}></textarea></label>
      <button class="mb" @click=${this.test} ?disabled=${!this.rules.length}>Test</button>
      ${this.result === null ? nothing : html`<p role="status">${this.result.length ? `Matched: ${this.result.map(rule => rule.name).join(', ')}` : 'No rule matches that text.'}</p>`}
    `;
  }
}

customElements.define('k-forms-admin-rules', RuleEditor);
