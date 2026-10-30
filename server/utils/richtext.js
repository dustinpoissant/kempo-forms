import sanitizeHtml from 'sanitize-html';
import renderMarkdown from 'kempo-ui/dist/utils/renderMarkdown.js';

/*
  Rich text that came from a visitor, made safe before it is stored, shown in the admin or put in an email.

  Two kinds reach here. Markdown is rendered with kempo-ui's renderMarkdown (the vendored marked parser, which has no DOM
  dependency, so the server can run it) and the HTML that comes out is then cleaned like any other. HTML (a rich text field) is
  cleaned directly. kempo-ui's own sanitizeHtml needs `document` and documents itself as a browser-side defence, so the server
  uses sanitize-html, an allowlist sanitiser with no DOM.

  The rules: only the tags below; only the attributes listed for each tag; links and images only to http, https or (links) mailto,
  so `javascript:`, `vbscript:` and `data:` are refused; no event handlers and no `style` attribute; links get rel="noopener
  noreferrer nofollow". These tags are removed together with everything inside them: script, style, iframe, object, embed, svg,
  math, noscript, template, form, textarea, select.
*/

const OPTIONS = {
  allowedTags: [
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel'],
    img: ['src', 'alt', 'title'],
    th: ['align', 'colspan', 'rowspan'],
    td: ['align', 'colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'noscript', 'template', 'form', 'textarea', 'select', 'option'],
  transformTags: {
    a: (tag, attribs) => ({ tagName: 'a', attribs: { ...attribs, rel: 'noopener noreferrer nofollow' } }),
  },
};

export const sanitizeRichHtml = html => sanitizeHtml(String(html ?? ''), OPTIONS);

export const markdownToHtml = markdown => sanitizeRichHtml(renderMarkdown(String(markdown ?? '')));

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&#x27;': '\'', '&nbsp;': ' ' };

/*
  The words of some rich text without its markup, for the spam rules and for places that cannot show HTML (a CSV).
*/
export const htmlToText = html => sanitizeHtml(String(html ?? ''), { allowedTags: [], allowedAttributes: {}, nonTextTags: OPTIONS.nonTextTags })
  .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, entity => ENTITIES[entity])
  .replace(/\s+/g, ' ')
  .trim();

export const markdownToText = markdown => htmlToText(renderMarkdown(String(markdown ?? '')));
