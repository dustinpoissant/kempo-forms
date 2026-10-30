import Dialog from '/kempo-ui/components/Dialog.js';
import Toast from '/kempo-ui/components/Toast.js';

/*
  What every admin screen shares: asking before something that cannot be undone, telling the user how it went, and showing a date.
*/

export { Toast };

export const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

/*
  Resolves true when the user agrees. `text` is shown as plain text, so a form's title in it cannot be read as markup.
*/
export const confirm = (text, { title = 'Are you sure?', yes = 'Yes', no = 'Cancel' } = {}) => new Promise(resolve => {
  Dialog.confirm(`<p class="m">${escapeHtml(text).replaceAll('\n', '<br>')}</p>`, resolve, { title, confirmText: yes, cancelText: no });
});

export const formatDate = value => value ? new Date(value).toLocaleString() : '';

export const STATUS_LABELS = { live: 'Live', paused: 'Paused', archived: 'In the Trash', new: 'New', read: 'Read', spam: 'Spam', trashed: 'In the Trash' };

export const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
