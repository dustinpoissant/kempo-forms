# Changelog

## Unreleased

- A **Form** widget for kempo's page builder (`page_widgets`): choose a form from a list in the settings, optionally show its title as a heading, and it is saved as `<k-forms-form slug="..." heading="...">`. The editor shows a card for it, not the live form. Needs kempo 4.10.0 or later, which has the page builder. The Insert a form button of the older Content editor stays as it is.

## 0.1.0

First release.

- Forms built in the admin: 23 field types (native inputs plus kempo-ui's combobox, segmented control, switch, calendar, time, rating, slider, colour picker, tags, markdown editor, rich text editor and image crop), a hint, placeholder, length limits and pattern on each, drag to reorder
- Conditional fields: show a field only when an earlier field has a given answer, decided by one evaluator shared by the browser and the server
- Forms in the page editor: an Insert a form button in the Content editor and a placeholder card (with a link to edit the form) that saves as <k-forms-form slug>; the component is loaded automatically on pages that have a form, no script tag needed
- A public component `<k-forms-form>` and a page of its own at `/forms/<address>`; slots for other extensions
- Submissions kept with a copy of the form as it was sent, with a history, notes, a spam queue, filters, search and CSV export
- Optional email: notifications to a form's recipients and the site-wide ones (Reply-To is the visitor's address, with a kempo release after 4.9.12 and a sender that supports it), a confirmation to the visitor, each result in the history. Only needs an email extension if turned on
- Spam: honeypot, a per-visitor rate limit (insert-then-count, safe under simultaneous attempts), regex rules run on RE2, and the `submission:filter` hook for captcha and AI extensions
- Rich text in answers (`off`, `markdown`, `html`), cleaned on the server with sanitize-html
- Personal data: fields marked personal are erased on a deletion request (account deleted, or by email from the admin), the rest of the submission and a hash-only record of the request are kept; a retry for requests that fail
- A Trash for forms and submissions, restore, empty, and retention by days
- File uploads through kempo-files when it is installed, stored as private, never-reviewable, download-only files
- Account requirement, for the whole site and per form
- Permissions, three groups, a dashboard widget, an admin nav group, hooks and an SDK for integrations
- Unit tests on PGlite, integration tests on Postgres, and a browser suite that boots a real kempo site and drives every screen
