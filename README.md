# kempo-forms

Contact and custom forms for [kempo](https://www.npmjs.com/package/kempo) CMS. Build a form in the admin, put it on any page, keep every submission, and have it emailed to as many people as you like. Spam is filtered by a honeypot, a rate limit and your own regex rules, and other extensions can add a captcha or an AI spam score through hooks.

- **Forms are made in the admin**: fields of 23 kinds (text, choices, dates, stars, sliders, colours, tags, markdown, rich text, files), each with a label, hint, placeholder, pattern and a "Show when" condition, dragged into order
- **Conditional fields**: show a phone number box only when "Phone" is chosen. The server decides again from what it received, so a hidden field's answer is never kept
- **Submissions are kept** with the form as it was when they were sent, so editing a form never makes an old submission unreadable. Filter, search, flag, add notes, export to CSV
- **Email is optional**: send each submission to the form's recipients and/or the site-wide ones, and optionally confirm to the visitor. Needs an email extension (kempo-resend or kempo-smtp), only if you turn it on
- **Spam**: honeypot, per-visitor rate limit, regex rules for the whole site and per form, all run on RE2 so no pattern can hang the server. Flagged submissions are kept for review, not emailed
- **Privacy**: fields can be marked personal and are erased when a person asks for their data to be deleted (CCPA, TCPA), while the rest of the submission is kept
- **A Trash** like an email client's: forms and submissions go there first, can be restored, and are removed for good only when it is emptied
- **File uploads** through [kempo-files](https://www.npmjs.com/package/kempo-files), if it is installed, stored as private, download-only files that can never be made to run
- **Hooks and slots** for everything an integration needs: add a spam verdict, change who is emailed, deliver somewhere else, add panels to the admin, put a captcha in the form

## Install

```bash
npm install kempo-forms
```

Then **Admin > Extensions > Install** next to `kempo-forms`. Put the people who will use it in the groups below. An existing site needs `npx drizzle-kit push` once if it has no `scheduledJob` table, or the sweep (retention, erasure retries) will not run.

To email submissions, also install an email extension (`kempo-resend` or `kempo-smtp`), then turn on **Email each new submission** under **Forms > Settings**. Without one the switch stays off and forms work exactly the same, minus the emails.

For file fields, install `kempo-files`. They appear in the field list by themselves.

## Making a form

**Admin > Forms > New form.** It starts with a name, an email and a message. Open a field to change it; drag it by its handle to move it.

| Tab | What it holds |
|---|---|
| **Fields** | The fields, in order. Add one from the list under them |
| **Form** | Title, address, introduction, button text, the message (or redirect) after sending, whether it has its own page, who can send it |
| **Notifications** | Who is emailed, the site-wide recipients, the confirmation to the visitor |
| **Spam** | This form's own rules, with a tester |
| **Place it** | The page address and the snippet to paste into another page |

Save once for the whole form with **Save form** at the top. A form can be paused (it stays on the page and says so), duplicated, or archived (moved to the Trash).

### Where the form appears

- **Its own page** at `/forms/<address>`, unless turned off.
- **Inside any page.** In the page editor's Content editor, the toolbar has an **Insert a form** button (the Assignment icon). It asks which form and puts a card in the editor that stands for it, with a link to the form's own page to edit it. The card is not editable in the page editor and saves as the element below. Writing the element by hand works too:

```html
<k-forms-form slug="contact"></k-forms-form>
```

The form component is loaded on every public page that has one, so no script tag is needed. The card and the button need kempo (a release after 4.9.12, with its editor extensions) and kempo-ui (a release after 0.7.2, with URL `nodes` and the `toolbar-top-extra` slot on `k-html-editor`); without them the page editor still works but removes a form it does not understand, so place forms by hand on older versions and do not save that page in the editor.

`heading="1"` shows the form's title and introduction as a heading of that level. JavaScript is required: the form is a web component.

### Field types

| Type | Input | Stored as |
|---|---|---|
| Short text, long text, email, phone, number | native | string, number |
| Dropdown, choose one, checkbox, choose several | native | option value, boolean, list |
| Searchable dropdown | `k-combobox` | option value |
| Segmented choice | `k-segmented-control` | option value |
| Yes / no switch | `k-toggle` | boolean |
| Date, date range | `k-calendar` | `YYYY-MM-DD`, `[start, end]` |
| Time | `k-time` | `HH:MM` |
| Star rating | `k-rating` | 1 to 5 |
| Slider | `k-slider` | number, or `[low, high]` |
| Colour | `k-color-picker` | `#rrggbb` |
| Tags | `k-tags` | list |
| Formatted text (markdown) | `k-markdown-editor` | markdown |
| Formatted text (rich text) | `k-html-editor` | cleaned HTML |
| File, image | native, `k-image-crop` | file ids (kempo-files) |

Each field can also be required, have a hint and placeholder, a minimum and maximum length, and a pattern the whole answer must fit.

### Show a field only sometimes

Under **Show this field only when**, pick an earlier field, a comparison (is, is not, includes, is ticked, is not ticked, is empty, is not empty) and a value. A field that depends on a hidden field is hidden too. Dragging a field above the one it depends on takes the condition off and says so. The browser and the server decide visibility with the same code (`server/utils/fields/conditions.js`, copied byte for byte to `public/utils/conditions.js`, and a test fails if they differ).

A hidden field is not shown, not checked, not required, not saved, and not emailed.

### Rich text

The **Formatted text in answers** setting decides what is accepted: `off`, `markdown` (the default) or `html` (markdown and rich text). Markdown is rendered with kempo-ui's `renderMarkdown`, and all of it is cleaned by `sanitize-html` on the server: only a list of safe tags and attributes survive, links and images only to http, https or mailto, no scripts, no event handlers, no inline styles, links get `rel="noopener noreferrer nofollow"`. HTML is cleaned the same way before it is stored, so no unclean copy exists.

## Submissions

**Admin > Forms > Submissions.** Tabs: **New** (not read yet), **All**, **Spam** (flagged for you to check) and **Trash**. Filter by form, date or text; tick rows to mark them read, flag or clear spam, or move them to the Trash. **Export** downloads what you are looking at as a CSV (a cell that starts with `=`, `+`, `-` or `@` is prefixed so a spreadsheet will not run it).

A submission's page shows each answer under its label, the spam verdicts, its history (received, read, notes, emails, status changes) and lets you add notes, send the email again, or flag it. A new submission is marked read when someone who may manage submissions opens it.

## Email

Off until **Email each new submission** is on. Then every new submission (never spam) is emailed, one message per address, to the form's own recipients plus the site-wide ones (unless the form leaves them out). Each address's result is in the submission's history; a failure never loses the submission and never reaches the visitor. A form can also **email the visitor to say it arrived**, to the address in an email field you choose, with a message of your own.

The messages come from `emails/submission-notification.page.html` and `emails/submission-confirmation.page.html`; a site overrides one at `templates/emails/kempo-forms/<name>.page.html`. Everything a visitor typed is escaped before it reaches a template.

The notification's Reply-To is the address the visitor gave in the form's email field, so replying to it goes to them. This needs a kempo release after 4.9.12 and a sender that supports it (kempo-resend and kempo-smtp do, from the versions that came with it); with an older kempo or sender the header is simply left off, and the notification also shows the visitor's address as a link in the body. The confirmation email to the visitor has no Reply-To.

## Spam

1. **Honeypot.** A hidden field named `website_url`. A bot that fills it gets a normal success answer and the submission is kept as spam.
2. **Rate limit.** Attempts per visitor per hour (default 10), counted whether or not they were accepted. Visitors are told apart by a salted hash of their address that is never shown or stored with a submission. **The site is behind my own proxy** makes it use `X-Forwarded-For`; leave it off otherwise, or anyone can send that header.
3. **Regex rules**, for the whole site (Settings > Spam) and for each form. A rule has a name, a pattern, whether capital letters matter and optionally the fields it looks at. What a match does is the **When a rule catches a submission** setting: keep it as spam (default) or refuse it without saving.
4. **Extensions**, through `kempo-forms:submission:filter` (below): a captcha, an AI score, a blocklist.

Patterns run on [RE2](https://github.com/google/re2), which cannot be made to run for ever by a crafted pattern or answer. The price is that backreferences and lookaround are not supported; a pattern that uses them is refused when it is saved, with the reason. A rule's record names the rule and the field, never the text that matched.

A spam submission is kept (Spam tab) and not emailed. **This is not spam** moves it out and sends the notifications it never got.

## Privacy and erasure

Mark a field **Contains personal information** (on by default for email and phone). When a person asks for their data to be deleted:

- **An account is deleted**: kempo fires `user:deleted`, and their submissions (found by their account and by the email address they had) lose their personal fields.
- **Someone with no account asks you**: **Forms > Settings > Privacy > Find a person's data**. A dialog asks for their email address; it is replaced by a second one that lists what you hold, with buttons to download it (for an access request) or erase it.

Erasing removes the personal values, clears the address, browser and account kept with the submission, deletes personal files from kempo-files, and removes the text of notes. It keeps the submission itself, every answer that is not personal (a consent box included, since a claim about consent needs the proof), its status and its history, which lists the fields erased and never their values. The record of the request holds a salted hash of the email, never the email. A request is written down before anything is erased, so one that fails halfway is retried every minute by the sweep. It cannot reach emails already delivered, or backups.

This is the design for these requests, not legal advice; check the details (the 45-day response window, what counts as proof of consent) with counsel.

By default the IP address is not stored at all. **Keep the visitor's IP address** turns that on.

## The Trash

Archiving a form moves it to the Trash tab on the Forms page; trashing submissions moves them to the Trash tab on the Submissions page. Nothing is deleted, and files stay on disk but cannot be downloaded. Restoring puts everything back (a form comes back paused, so it does not start taking submissions by surprise). **Empty the Trash** deletes for good, forms with their submissions, files included, after a confirmation that says how many.

**Retention** (Settings > Privacy) deletes submissions older than a number of days; spam has its own, shorter clock (30 days).

## File uploads

With [kempo-files](https://www.npmjs.com/package/kempo-files) installed, **File upload** and **Image upload** appear in the field list. Each upload is stored with kempo-files' `reviewable: false`: it can never be approved to run, source files are served as plain text, PDFs and Office files as downloads, images as images, all with `nosniff`. Nothing is public, and the visitor is given no link: staff open them from the submission's page, and they need `files:download`. Anonymous uploads are owned by `kempo-forms`; a signed-in visitor owns their own. Names are prefixed with the submission id and made safe, so two visitors sending `resume.pdf` never collide and no name can leave its folder.

Limits: **Largest file** and **Most files in one submission** (Settings > Files), and per field the accepted extensions (a convenience for the visitor; the safety is how the files are served) and the most files. A refused submission stores nothing; a spam submission keeps its files for review.

## Permissions and groups

| Permission | Lets you |
|---|---|
| `forms:forms:view` | See forms and their editor |
| `forms:forms:manage` | Create, edit, duplicate, pause, archive and restore forms; empty the forms Trash |
| `forms:submissions:view` | See submissions, spam verdicts, history; export; find a person's data |
| `forms:submissions:manage` | Change status, add notes, resend, trash, restore, empty the submissions Trash, erase a person's data |
| `forms:settings:manage` | Change the settings |

| Group | Permissions |
|---|---|
| `kempo-forms:support` | read and handle submissions; cannot change forms |
| `kempo-forms:editor` | build forms and read submissions |
| `kempo-forms:administrator` | everything |

Nobody is put in a group automatically, and nobody needs a permission to send a form.

## Settings

On the Forms page, under the **Settings** tab (the same values also appear on kempo's own `/admin/settings`):

| Setting | Default | |
|---|---|---|
| `site_url` | `http://localhost:3000` | Used for the link in notification emails |
| `default_recipients` | | Site-wide recipients, comma separated |
| `email_notifications` | off | Needs an email extension to be turned on |
| `require_account` | off | Only signed-in people can send forms; a form can override it |
| `rich_text` | `markdown` | `off`, `markdown` or `html` |
| `max_field_length` | 5000 | Longest answer, in characters |
| `spam_action` | `spam` | `spam` keeps it for review, `reject` refuses it |
| `spam_rules` | none | Site-wide regex rules |
| `rate_limit_per_hour` | 10 | Attempts per visitor; 0 turns it off |
| `store_ip` | off | Keep the IP address with each submission |
| `trust_proxy` | off | Read the address from `X-Forwarded-For` |
| `retention_days` | 0 | Delete submissions after this many days; 0 keeps them |
| `spam_retention_days` | 30 | The same, for spam |
| `upload_max_bytes`, `upload_max_files` | 10 MB, 5 | Needs kempo-files |

## Hooks

Names are `kempo-forms:<resource>:<event>`. A **guard** runs before something happens: handlers may change the payload (pushing a verdict, editing a draft) and refuse by throwing `{ code, msg }`, which reaches the caller exactly; a handler that fails any other way refuses too, so a guard never fails open. A **note** runs after the change is saved; a handler that throws is logged and stops nothing. Register handlers in your extension's `kempo-config.json` under `hooks`.

| Hook | Kind | Payload | Lets you |
|---|---|---|---|
| `kempo-forms:form:before_save` | guard | `{ form, draft, actor }` | change or refuse a new or changed form (`form` is null on create) |
| `kempo-forms:form:saved` | note | `{ form, previous, actor }` | react |
| `kempo-forms:form:status_changed` | note | `{ form, from, to, actor }` | |
| `kempo-forms:form:deleted` | note | `{ formSlug, actor }` | clean up your own data |
| `kempo-forms:submission:filter` | guard | `{ form, values, extras, meta, verdicts, actor }` | **push verdicts** (below). The spam extension point |
| `kempo-forms:submission:before_save` | guard | `{ form, values, data, meta, extras, actor }` | refuse, or change `values` and `data` after validation |
| `kempo-forms:submission:saved` | note | `{ submission, form, actor }` | deliver it somewhere else (webhook, chat, CRM) |
| `kempo-forms:submission:notify` | guard | `{ submission, form, recipients }` | add or remove the people emailed, or refuse the email |
| `kempo-forms:submission:sent` | note | `{ submission, recipient, ok, error }` | record or alert on each email |
| `kempo-forms:submission:status_changed` | note | `{ submission, from, to, actor, reason }` | |
| `kempo-forms:submission:deleted` | note | `{ submissionId, formSlug, actor }` | clean up your own data |
| `kempo-forms:submission:erased` | note | `{ submissionId, formSlug, keys }` | delete the personal data **you** keep for it |
| `kempo-forms:email:context` | guard | `{ submission, form, template, context }` | add to or change what the notification shows |

`meta` is `{ ip, userAgent, userId }` (`ip` is the real address, passed to hooks whether or not it is stored). `extras` is everything the browser sent besides the answers: a captcha token, the honeypot.

### Adding a spam verdict

```js
// my-extension/hooks/filter.js
export default async ({ extras, meta, verdicts }) => {
  const ok = await verifyWithMyService(extras['my-token'], meta.ip);
  verdicts.push(ok
    ? { source: 'my-extension', action: 'accept', reason: 'Passed', score: 0.02 }
    : { source: 'my-extension', action: 'reject', reason: 'Failed the check', message: 'Please complete the check and try again.' });
};
```

`action` is `accept` (recorded, changes nothing), `spam` (saved as spam, not emailed) or `reject` (refused, nothing saved, `message` shown to the visitor). Every handler's verdicts are collected and decided together, so the order extensions run in never changes the outcome. Anything else counts as `accept`.

## Putting things in the form and the admin

Slots on `<k-forms-form>`: put an element in one with `slot="…"`, usually by contributing it to a location from a `*.global.html` file.

| Slot | Where |
|---|---|
| `before-fields` | above the first field |
| `before-submit` | above the submit button, inside the form. **A captcha goes here**: give its hidden input a `name` and the attribute `data-forms-extra`, and its value is sent as an extra for the hooks to check |
| `after-form` | below the form |

Locations (declare yours in the same way): `forms-page-before`, `forms-page-after` (the form's own page), `forms-before-fields`, `forms-before-submit`, `forms-after-form` (inside the component on that page), `forms-admin-tabs` (more tabs on the Forms page), `forms-admin-form-panels` (slot `panels` in the editor), `forms-admin-submission-panels` and `forms-admin-submission-actions` (slots `panels` and `actions` on a submission), `forms-admin-settings-sections` (slot `sections` under the settings tabs).

## Server SDK

```js
import { submitForm, getSubmission, listSubmissions, setSubmissionStatus, setSubmissionData, requestErasure } from 'kempo-forms/sdk';

// Keep a score with a submission, to show in your own panel.
await setSubmissionData({ id, key: 'my-extension:score', value: 0.12, actor: 'my-extension' });
```

Every function returns `[error, data]` with `error = { code, msg }`, never throws, takes an optional `actor` (written to the history), and does no permission check of its own: the routes decide who may do what. `submitForm` runs the whole pipeline with the same `{ slug, values, extras, files, meta }` a visitor's request produces, so another extension can create submissions from its own intake.

Forms: `getForm`, `getFormBySlug`, `listForms`, `createForm`, `updateForm`, `setFormStatus`, `duplicateForm`, `emptyFormTrash`, `previewEmptyTrash`. Submissions: `submitForm`, `getSubmission`, `getSubmissionDetail`, `listSubmissions`, `countByStatus`, `setSubmissionStatus`, `addSubmissionNote`, `setSubmissionData`, `trashSubmissions`, `restoreSubmissions`, `purgeSubmissions`, `emptySubmissionTrash`, `resendNotification`, `exportSubmissionsCsv`. Privacy and spam: `findMatches`, `requestErasure`, `testRules`. Also `readConfig` and `runSweep`.

A browser client is at `/forms/sdk.js`.

## HTTP

Public (no session needed): `GET /forms/api/forms/<slug>` (how to draw the form; nothing about where it goes) and `POST /forms/api/forms/<slug>/submit` (JSON `{ values, extras }`, or multipart with a `values` part, an `extras` part and one part per file). The answer is the same whether a submission was accepted or flagged as spam. A paused form answers 409, an unknown or archived one 404, a refused one 403, too many attempts 429 with `Retry-After`, a form that needs an account 401, and a bad answer 400 with `errors` for each field.

Admin routes are under `/forms/api/kempo-forms/` and each checks its own permission: `forms`, `forms/<id>` (with `/status` and `/duplicate`), `trash`, `submissions` (with `/counts`, `/export`, `/status`, `/trash`, `/restore`, `/forms`, `/<id>` and its `/note` and `/resend`), `settings`, `spam/test`, `privacy/find`, `privacy/export`, `privacy/erase`, `summary`, `meta`.

A dashboard widget shows new submissions today and this week, the unread ones, and the spam waiting for review.

## Development

```bash
npm install
npm run link:local        # symlinks ../kempo, ../kempo-server, ../kempo-ui, ../kempo-files and ../kempo-smtp into node_modules
npm test                  # the unit tier: an in-memory Postgres (PGlite), no services needed
docker compose up -d      # a throwaway Postgres on port 5452 for the integration tier
DATABASE_URL=postgresql://kempo:kempo@localhost:5452/kempo_forms_test npx drizzle-kit push --force
DATABASE_URL=postgresql://kempo:kempo@localhost:5452/kempo_forms_test npm run test:integration
```

The integration tier runs the same suites on real Postgres (the rate limit and its simultaneous attempts, for one), and boots its own throwaway kempo site on a random port, installs the extension through kempo's own route, and drives every screen in Chromium with Playwright, leaving screenshots in `tests/.tmp-site/screens`. The upload tests and the browser cases that need kempo-files or kempo-smtp (which really delivers an email to a local SMTP server) run only where those are linked in.

Never commit a `file:` specifier: `link:local` uses `--no-save`.

## Out of scope

Multi-step forms, payments (see kempo-payments), a contact list or CRM (kempo-inventory, through a small bridge on `submission:saved`), analytics, and forms that work without JavaScript.
