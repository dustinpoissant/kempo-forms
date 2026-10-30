import { existsSync } from 'fs';
import path from 'path';
import { eq, sql } from 'drizzle-orm';
import { kempoFormsForm, kempoFormsSubmission } from '../server/db/schema.js';
import { db, integrationOnly, integrationTier } from './helpers/db.js';
import { purge } from './helpers/forms.js';
import { buildSite, call, joinExtensionGroups, login, purgeSite, screensDir, seedPeople, startServer, stopServer } from './helpers/site.js';

/*
  The extension in a real browser, on a real kempo site, through every screen.

  A throwaway site is built and served by this suite (see helpers/site.js); kempo-forms is installed into it through kempo's own
  install route, the way an administrator would. Chromium is driven by Playwright. Each screen is opened, used, and checked for
  console errors, and a screenshot of each is saved to tests/.tmp-site/screens.

  The HTTP contract — who may reach which route — is checked over plain HTTP for every audience: nobody, a member, support, an
  editor and an administrator.

  Integration tier only: it needs a real Postgres and a second server process.
*/

const USERS = {
  admin: { name: 'Forms Admin', email: 'forms-admin@test.local', password: 'FormsAdmin123!', groups: ['system:Administrators'] },
  editor: { name: 'Forms Editor', email: 'forms-editor@test.local', password: 'FormsEditor123!', groups: ['kempo-forms:editor'] },
  support: { name: 'Forms Support', email: 'forms-support@test.local', password: 'FormsSupport123!', groups: ['kempo-forms:support'] },
  member: { name: 'Plain Member', email: 'forms-member@test.local', password: 'FormsMember123!', groups: [] },
};

/*
  kempo-files and kempo-smtp are optional: they are put on the site when they are linked in (`npm run link:local`), and the cases
  that need them say so and pass when they are not.
*/
const OPTIONAL = ['kempo-files', 'kempo-smtp'].filter(name => existsSync(path.resolve('node_modules', name, 'kempo-config.json')));
const has = name => OPTIONAL.includes(name);
const needs = (name, run) => async helpers => has(name) ? run(helpers) : helpers.pass(`runs where ${name} is linked in (npm run link:local)`);

const state = { server: null, browser: null, tokens: {}, ids: {}, errors: [], page: null, form: null, formId: null };

/*
  Console errors on our pages are failures. A missing icon is not: k-icon looks for each icon in several places in turn and the
  misses are 404s by design.
*/
const IGNORED = [/Failed to load resource.*404/, /icons\//, /favicon/];

const newPage = async who => {
  const context = await state.browser.newContext({ viewport: { width: 1280, height: 900 } });
  if(who) await context.addCookies([{ name: 'session_token', value: state.tokens[who], url: state.server.base }]);
  const page = await context.newPage();
  state.page = page;
  page.on('console', message => {
    if(message.type() === 'error' && !IGNORED.some(pattern => pattern.test(message.text()))) state.errors.push(`${who || 'anonymous'} ${page.url()}: ${message.text()}`);
  });
  page.on('pageerror', error => state.errors.push(`${who || 'anonymous'} ${page.url()}: ${error.message}`));
  return page;
};

const shot = (page, name) => page.screenshot({ path: path.join(screensDir, `${name}.png`), fullPage: true });

const api = (method, url, who, body) => call(state.server.base, method, `/forms/api${url}`, { token: who ? state.tokens[who] : null, body });

const ADMIN = '/admin/extension/kempo-forms';

const FIELDS = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'how', label: 'How should we reach you?', type: 'radio', required: true, options: ['Phone', 'Email'] },
  { key: 'phone', label: 'Phone number', type: 'tel', required: true, showWhen: { key: 'how', operator: 'equals', value: 'Phone' } },
  { key: 'address', label: 'Email address', type: 'email', required: true, showWhen: { key: 'how', operator: 'equals', value: 'Email' } },
  { key: 'note', label: 'Anything else', type: 'textarea' },
];

const tests = {
  'a site boots and kempo-forms installs through kempo’s own route': async ({ pass, fail }) => {
    await purgeSite({ users: USERS, extensions: ['kempo-forms', 'kempo-files', 'kempo-smtp'] });
    await purge();
    /* The tables go too, so the installer has to make them itself from the schema, as it does on a real site. */
    for(const table of ['kempoFormsSubmissionEvent', 'kempoFormsSubmission', 'kempoFormsAttempt', 'kempoFormsErasure', 'kempoFormsForm']) await db.execute(sql.raw(`DROP TABLE IF EXISTS "${table}" CASCADE`));
    await buildSite({ own: 'kempo-forms', others: OPTIONAL });
    state.ids = await seedPeople(USERS);
    state.server = await startServer();

    state.tokens.admin = await login(state.server.base, USERS.admin);
    if(!state.tokens.admin) return fail('the administrator could not sign in');

    const install = async name => {
      const installed = await call(state.server.base, 'POST', '/kempo/api/extensions', { token: state.tokens.admin, body: { name } });
      return installed.status === 200 ? null : `installing ${name}: ${installed.status} ${JSON.stringify(installed.data)}`;
    };
    for(const name of ['kempo-files', 'kempo-forms'].filter(entry => entry === 'kempo-forms' || has(entry))){
      const problem = await install(name);
      if(problem) return fail(problem);
    }

    /* With nothing on the site that can send email, the switch for emailing submissions is refused. */
    const early = await api('PUT', '/kempo-forms/settings', 'admin', { email_notifications: true });
    if(early.status !== 409) return fail(`email notifications were allowed with no email extension: ${early.status} ${JSON.stringify(early.data)}`);
    if(has('kempo-smtp')){
      const problem = await install('kempo-smtp');
      if(problem) return fail(problem);
    }

    const tables = (await db.execute(sql`select tablename from pg_tables where tablename like 'kempoForms%'`)).map(row => row.tablename);
    if(tables.length !== 5) return fail(`the installer made ${tables.length} of 5 tables: ${tables}`);
    const indexes = (await db.execute(sql`select indexname from pg_indexes where tablename like 'kempoForms%'`)).map(row => row.indexname);
    if(!indexes.includes('kempoFormsForm_slug_idx')) return fail('the installer did not make the unique address index');

    await joinExtensionGroups(USERS, state.ids);
    for(const who of ['editor', 'support', 'member']){
      state.tokens[who] = await login(state.server.base, USERS[who]);
      if(!state.tokens[who]) return fail(`${who} could not sign in`);
    }

    const { chromium } = await import('playwright');
    state.browser = await chromium.launch();
    pass(state.server.base);
  },

  'every route answers each audience as it should': async ({ pass, fail }) => {
    if(!state.server) return fail('no site');
    const created = await api('POST', '/kempo-forms/forms', 'editor', { title: 'Contact us', slug: 'contact-us', fields: FIELDS, notifyEmails: ['owner@example.com'] });
    if(created.status !== 201) return fail(`an editor could not make a form: ${created.status} ${JSON.stringify(created.data)}`);
    state.form = created.data.form;
    state.formId = created.data.form.id;

    const contract = [
      ['GET', '/forms/contact-us', null, 200],
      ['GET', '/forms/nope', null, 404],
      ['GET', '/kempo-forms/forms', null, 401],
      ['GET', '/kempo-forms/forms', 'member', 403],
      ['GET', '/kempo-forms/forms', 'support', 403],
      ['GET', '/kempo-forms/forms', 'editor', 200],
      ['GET', '/kempo-forms/forms', 'admin', 200],
      ['POST', '/kempo-forms/forms', null, 401],
      ['POST', '/kempo-forms/forms', 'member', 403],
      ['POST', '/kempo-forms/forms', 'support', 403],
      ['PUT', `/kempo-forms/forms/${state.formId}`, 'support', 403],
      ['GET', `/kempo-forms/forms/${state.formId}`, 'editor', 200],
      ['POST', `/kempo-forms/forms/${state.formId}/duplicate`, 'member', 403],
      ['GET', '/kempo-forms/submissions', null, 401],
      ['GET', '/kempo-forms/submissions', 'member', 403],
      ['GET', '/kempo-forms/submissions', 'support', 200],
      ['GET', '/kempo-forms/submissions', 'editor', 200],
      ['GET', '/kempo-forms/submissions/forms', 'member', 403],
      ['GET', '/kempo-forms/submissions/forms', 'support', 200],
      ['GET', '/kempo-forms/submissions/export', 'member', 403],
      ['GET', '/kempo-forms/submissions/export', 'support', 200],
      ['POST', '/kempo-forms/submissions/trash', 'editor', 403],
      ['POST', '/kempo-forms/submissions/trash', 'support', 400],
      ['GET', '/kempo-forms/settings', 'support', 403],
      ['GET', '/kempo-forms/settings', 'editor', 403],
      ['GET', '/kempo-forms/settings', 'admin', 200],
      ['PUT', '/kempo-forms/settings', 'editor', 403],
      ['GET', '/kempo-forms/privacy/find?email=a@b.co', 'member', 403],
      ['GET', '/kempo-forms/privacy/find?email=a@b.co', 'support', 200],
      ['POST', '/kempo-forms/privacy/erase', 'editor', 403],
      ['GET', '/kempo-forms/summary', 'member', 403],
      ['GET', '/kempo-forms/summary', 'support', 200],
      ['GET', '/kempo-forms/meta', 'support', 403],
      ['GET', '/kempo-forms/meta', 'editor', 200],
      ['GET', '/kempo-forms/trash', 'support', 200],
      ['POST', '/kempo-forms/trash/empty', 'support', 200],
    ];

    const wrong = [];
    for(const [method, url, who, expected] of contract){
      const { status } = await api(method, url, who, method === 'GET' ? undefined : {});
      if(status !== expected) wrong.push(`${method} ${url} as ${who || 'nobody'}: expected ${expected}, got ${status}`);
    }
    if(wrong.length) return fail(`\n    ${wrong.join('\n    ')}`);
    pass(`${contract.length} route/audience pairs`);
  },

  'the admin pages are closed to people without a group': async ({ pass, fail }) => {
    const wrong = [];
    for(const url of [`${ADMIN}/`, `${ADMIN}/submissions/`, `${ADMIN}/form/`]){
      for(const [who, expected] of [[null, 302], ['member', 302], ['admin', 200]]){
        const { status } = await call(state.server.base, 'GET', url, { token: who ? state.tokens[who] : null });
        if(status !== expected) wrong.push(`${url} as ${who || 'nobody'}: expected ${expected}, got ${status}`);
      }
    }
    if(wrong.length) return fail(`\n    ${wrong.join('\n    ')}`);
    pass('');
  },

  'a visitor sees only the fields that apply, and the conditional answer is not kept': async ({ pass, fail }) => {
    const page = await newPage(null);
    await page.goto(`${state.server.base}/forms/contact-us`);
    await page.locator('k-forms-form form').waitFor();
    await shot(page, 'public-empty');

    const form = page.locator('k-forms-form');
    if(await form.locator('input[name="phone"]').count() || await form.locator('input[name="address"]').count()) return fail('both conditional fields show before a choice is made');

    await form.locator('input[name="name"]').fill('Ada Lovelace');
    await form.locator('input[type="radio"][value="Phone"]').check();
    await form.locator('input[name="phone"]').waitFor();
    if(await form.locator('input[name="address"]').count()) return fail('the email box shows while Phone is chosen');
    await form.locator('input[name="phone"]').fill('+1 555 123 4567');

    await form.locator('input[type="radio"][value="Email"]').check();
    await form.locator('input[name="address"]').waitFor();
    if(await form.locator('input[name="phone"]').count()) return fail('the phone box stays after switching to Email');

    await form.locator('input[name="address"]').fill('ada@example.com');
    await shot(page, 'public-filled');
    await form.getByRole('button', { name: 'Send' }).click();
    await form.getByText('Thank you').waitFor();
    await shot(page, 'public-sent');

    const [saved] = await db.select().from(kempoFormsSubmission).where(eq(kempoFormsSubmission.formSlug, 'contact-us'));
    if(!saved) return fail('nothing was saved');
    if(saved.values.address !== 'ada@example.com' || saved.values.how !== 'Email') return fail(`saved ${JSON.stringify(saved.values)}`);
    if('phone' in saved.values) return fail('the phone number typed before switching to Email must not be kept');
    await page.context().close();
    pass('');
  },

  'a form refuses what the server refuses and shows it beside the field': async ({ pass, fail }) => {
    const page = await newPage(null);
    await page.goto(`${state.server.base}/forms/contact-us`);
    const form = page.locator('k-forms-form');
    await form.locator('form').waitFor();
    await form.locator('input[name="name"]').fill('Bob');
    await form.locator('input[type="radio"][value="Email"]').check();
    await form.locator('input[name="address"]').fill('not-an-email');
    await form.getByRole('button', { name: 'Send' }).click();
    // The browser's own check stops an invalid email before it is sent, so the page is still the form.
    if(await form.getByText('Thank you').count()) return fail('an invalid email was accepted');
    await shot(page, 'public-invalid');
    await page.context().close();
    pass('');
  },

  'every kind of field draws, takes an answer, and is saved in its stored form': async ({ pass, fail }) => {
    const start = state.errors.length;
    const options = ['alpha', 'beta', 'gamma'];
    const settings = await api('PUT', '/kempo-forms/settings', 'admin', { rich_text: 'html' });
    if(settings.status !== 200) return fail(`could not allow rich text: ${JSON.stringify(settings.data)}`);
    const created = await api('POST', '/kempo-forms/forms', 'editor', {
      title: 'All kinds', slug: 'all-kinds',
      fields: [
        { key: 'f_text', label: 'Text', type: 'text' },
        { key: 'f_area', label: 'Area', type: 'textarea' },
        { key: 'f_number', label: 'Number', type: 'number', settings: { min: 0, max: 100 } },
        { key: 'f_select', label: 'Select', type: 'select', options },
        { key: 'f_radio', label: 'Radio', type: 'radio', options },
        { key: 'f_checkbox', label: 'Checkbox', type: 'checkbox' },
        { key: 'f_checkboxes', label: 'Checkboxes', type: 'checkboxes', options },
        { key: 'f_combobox', label: 'Combobox', type: 'combobox', options },
        { key: 'f_segmented', label: 'Segmented', type: 'segmented', options },
        { key: 'f_toggle', label: 'Toggle', type: 'toggle' },
        { key: 'f_date', label: 'Date', type: 'date' },
        { key: 'f_range', label: 'Dates', type: 'daterange' },
        { key: 'f_time', label: 'Time', type: 'time' },
        { key: 'f_rating', label: 'Rating', type: 'rating' },
        { key: 'f_slider', label: 'Slider', type: 'slider', settings: { min: 0, max: 100 } },
        { key: 'f_color', label: 'Colour', type: 'color' },
        { key: 'f_tags', label: 'Tags', type: 'tags', options },
        { key: 'f_markdown', label: 'Markdown', type: 'markdown' },
        { key: 'f_rich', label: 'Rich text', type: 'richtext' },
      ],
    });
    if(created.status !== 201) return fail(`could not make the form: ${JSON.stringify(created.data)}`);

    const page = await newPage(null);
    await page.goto(`${state.server.base}/forms/all-kinds`);
    const form = page.locator('k-forms-form');
    await form.locator('form').waitFor();
    for(const tag of ['k-combobox', 'k-segmented-control', 'k-toggle', 'k-calendar', 'k-time', 'k-rating', 'k-slider', 'k-color-picker', 'k-tags', 'k-markdown-editor', 'k-html-editor']){
      await form.locator(tag).first().waitFor({ state: 'attached' });
    }
    await shot(page, 'public-all-kinds');

    await form.locator('input[name="f_text"]').fill('Some text');
    await form.locator('textarea[name="f_area"]').fill('Line one\nLine two');
    await form.locator('input[name="f_number"]').fill('42');
    await form.locator('select[name="f_select"]').selectOption('beta');
    await form.locator('input[type="radio"][name="f_radio"][value="gamma"]').check();
    await form.locator('input[type="checkbox"][name="f_checkbox"]').check();
    await form.locator('input[type="checkbox"][name="f_checkboxes"][value="alpha"]').check();
    await form.locator('input[type="checkbox"][name="f_checkboxes"][value="gamma"]').check();

    /* The kempo-ui inputs are given their value the way a person's click would: through the component's own property, which makes the component announce the change itself. */
    await page.evaluate(() => {
      const root = document.querySelector('k-forms-form').shadowRoot;
      root.querySelector('k-combobox').value = 'alpha';
      root.querySelector('k-segmented-control').value = 'beta';
      root.querySelector('k-toggle').value = true;
      const calendars = root.querySelectorAll('k-calendar');
      calendars[0].value = '2026-03-15';
      calendars[1].value = '2026-04-01,2026-04-09';
      root.querySelector('k-time').value = '14:30';
      root.querySelector('k-rating').value = 4;
      root.querySelector('k-slider').value = '35';
      root.querySelector('k-color-picker').value = '#ff8800';
      root.querySelector('k-tags').value = 'alpha,beta';
      root.querySelector('k-markdown-editor').value = '**bold** text';
      root.querySelector('k-html-editor').value = '<p>Rich <strong>text</strong></p>';
      for(const tag of ['k-slider', 'k-color-picker']) root.querySelector(tag).dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(800);

    await form.getByRole('button', { name: 'Send' }).click();
    await form.getByText('Thank you').waitFor();
    await shot(page, 'public-all-kinds-sent');

    const [saved] = await db.select().from(kempoFormsSubmission).where(eq(kempoFormsSubmission.formSlug, 'all-kinds'));
    const wrong = [];
    const expect = (key, expected) => {
      if(JSON.stringify(saved.values[key]) !== JSON.stringify(expected)) wrong.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(saved.values[key])}`);
    };
    expect('f_text', 'Some text');
    expect('f_area', 'Line one\nLine two');
    expect('f_number', 42);
    expect('f_select', 'beta');
    expect('f_radio', 'gamma');
    expect('f_checkbox', true);
    expect('f_checkboxes', ['alpha', 'gamma']);
    expect('f_combobox', 'alpha');
    expect('f_segmented', 'beta');
    expect('f_toggle', true);
    expect('f_date', '2026-03-15');
    expect('f_range', ['2026-04-01', '2026-04-09']);
    expect('f_time', '14:30');
    expect('f_rating', 4);
    expect('f_slider', 35);
    expect('f_color', '#ff8800');
    expect('f_tags', ['alpha', 'beta']);
    expect('f_markdown', '**bold** text');
    if(!/<(strong|b)>text<\/(strong|b)>/.test(String(saved.values.f_rich))) wrong.push(`f_rich: ${saved.values.f_rich}`);
    await api('PUT', '/kempo-forms/settings', 'admin', { rich_text: 'markdown' });
    if(wrong.length) return fail(`\n    ${wrong.join('\n    ')}`);
    if(state.errors.length > start) return fail(state.errors.slice(start).join('\n'));
    await page.context().close();
    pass('');
  },

  'a file is sent from the form, kept inert and private, and only people with files:download can open it': needs('kempo-files', async ({ pass, fail }) => {
    const start = state.errors.length;
    const created = await api('POST', '/kempo-forms/forms', 'editor', {
      title: 'With a file', slug: 'with-a-file',
      fields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'doc', label: 'A document', type: 'file', required: true, settings: { accept: ['html', 'pdf'] } }],
    });
    if(created.status !== 201) return fail(`could not make the form: ${JSON.stringify(created.data)}`);

    const page = await newPage(null);
    await page.goto(`${state.server.base}/forms/with-a-file`);
    const form = page.locator('k-forms-form');
    await form.locator('form').waitFor();
    await form.locator('input[name="name"]').fill('Grace');
    await form.locator('input[type="file"]').setInputFiles({ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script><p>hello</p>') });
    await shot(page, 'public-file');
    await form.getByRole('button', { name: 'Send' }).click();
    await form.getByText('Thank you').waitFor();

    const [saved] = await db.select().from(kempoFormsSubmission).where(eq(kempoFormsSubmission.formSlug, 'with-a-file'));
    if(saved?.values.doc?.length !== 1) return fail(`saved ${JSON.stringify(saved?.values)}`);

    const detail = await api('GET', `/kempo-forms/submissions/${saved.id}`, 'admin');
    const file = detail.data.files[0];
    if(!file || !file.name.endsWith('-page.html') && file.name !== 'page.html') return fail(`the submission lists its file: ${JSON.stringify(detail.data.files)}`);

    const fetchFile = async who => {
      const response = await fetch(`${state.server.base}${file.url}`, { headers: who ? { cookie: `session_token=${state.tokens[who]}` } : {}, redirect: 'manual' });
      return { status: response.status, type: response.headers.get('content-type') || '', sniff: response.headers.get('x-content-type-options') };
    };
    const anonymous = await fetchFile(null);
    if(anonymous.status !== 401) return fail(`a stranger got ${anonymous.status}`);
    const supportView = await fetchFile('support');
    if(supportView.status !== 403) return fail(`support (no files:download) got ${supportView.status}`);
    const adminView = await fetchFile('admin');
    if(adminView.status !== 200 || !adminView.type.startsWith('text/plain') || adminView.sniff !== 'nosniff') return fail(`the administrator got ${JSON.stringify(adminView)}: the page must be served as text, never as a page`);

    const submissionPage = await newPage('admin');
    await submissionPage.goto(`${state.server.base}${ADMIN}/submission/?id=${saved.id}`);
    await submissionPage.locator('k-forms-admin-submission').getByRole('link', { name: /page\.html/ }).waitFor();
    await shot(submissionPage, 'admin-submission-file');
    if(state.errors.length > start) return fail(state.errors.slice(start).join('\n'));
    await submissionPage.context().close();
    await page.context().close();
    pass('');
  }),

  'an image is chosen, cropped to the form\'s ratio in the browser, sent, and served as an image only to people with files:download': needs('kempo-files', async ({ pass, fail }) => {
    const start = state.errors.length;
    const created = await api('POST', '/kempo-forms/forms', 'editor', {
      title: 'With a photo', slug: 'with-a-photo',
      fields: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'photo', label: 'Photo', type: 'image', required: true, settings: { aspectRatio: '1' } }],
    });
    if(created.status !== 201) return fail(`could not make the form: ${JSON.stringify(created.data)}`);

    const page = await newPage(null);
    await page.goto(`${state.server.base}/forms/with-a-photo`);
    const form = page.locator('k-forms-form');
    await form.locator('form').waitFor();
    await form.locator('k-image-crop').waitFor({ state: 'attached' });
    await form.locator('input[name="name"]').fill('Grace');

    /* A 200 x 100 picture is drawn in the page and handed to the cropper, the way choosing a file would; a square ratio must cut it to a square. */
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 200;
      canvas.height = 100;
      const context = canvas.getContext('2d');
      context.fillStyle = '#3366ff';
      context.fillRect(0, 0, 200, 100);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const cropper = document.querySelector('k-forms-form').shadowRoot.querySelector('k-image-crop');
      await cropper.loadImage(blob);
      await cropper.updateComplete;
    });
    await page.waitForTimeout(500);
    await shot(page, 'public-image');

    const missing = await form.locator('k-image-crop').evaluate(element => element.hasImage);
    if(!missing) return fail('the cropper did not take the picture');
    await form.getByRole('button', { name: 'Send' }).click();
    await form.getByText('Thank you').waitFor();

    const [saved] = await db.select().from(kempoFormsSubmission).where(eq(kempoFormsSubmission.formSlug, 'with-a-photo'));
    if(saved?.values.photo?.length !== 1) return fail(`saved ${JSON.stringify(saved?.values)}`);

    const detail = await api('GET', `/kempo-forms/submissions/${saved.id}`, 'admin');
    const file = detail.data.files[0];
    if(!file) return fail(`the submission lists no file: ${JSON.stringify(detail.data.files)}`);

    const fetchFile = async who => fetch(`${state.server.base}${file.url}`, { headers: who ? { cookie: `session_token=${state.tokens[who]}` } : {}, redirect: 'manual' });
    if((await fetchFile(null)).status !== 401) return fail('a stranger must not get the photo');
    if((await fetchFile('support')).status !== 403) return fail('support (no files:download) must not get the photo');
    const served = await fetchFile('admin');
    const bytes = Buffer.from(await served.arrayBuffer());
    if(served.status !== 200 || !(served.headers.get('content-type') || '').startsWith('image/png') || served.headers.get('x-content-type-options') !== 'nosniff') return fail(`the administrator got ${served.status} ${served.headers.get('content-type')}`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if(bytes.subarray(1, 4).toString() !== 'PNG' || width !== height || width < 50) return fail(`the photo is ${width} x ${height}, not a square cut from the picture`);

    if(state.errors.length > start) return fail(state.errors.slice(start).join('\n'));
    await page.context().close();
    pass(`${width} x ${height}`);
  }),

  'a paused form says so, and one in the Trash does not exist': async ({ pass, fail }) => {
    await api('POST', `/kempo-forms/forms/${state.formId}/status`, 'editor', { status: 'paused' });
    const page = await newPage(null);
    await page.goto(`${state.server.base}/forms/contact-us`);
    await page.locator('k-forms-form').getByText('not accepting submissions').waitFor();
    await shot(page, 'public-paused');

    await api('POST', `/kempo-forms/forms/${state.formId}/status`, 'editor', { status: 'archived' });
    await page.goto(`${state.server.base}/forms/contact-us`);
    await page.locator('k-forms-form').getByText('not available').waitFor();

    const restored = await api('POST', `/kempo-forms/forms/${state.formId}/status`, 'editor', { status: 'live' });
    if(restored.data.form.status !== 'paused') return fail('restoring brings it back paused');
    await api('POST', `/kempo-forms/forms/${state.formId}/status`, 'editor', { status: 'live' });
    await page.context().close();
    pass('');
  },

  'the forms list and the editor load and save, without a console error': async ({ pass, fail }) => {
    const start = state.errors.length;
    const page = await newPage('editor');
    await page.goto(`${state.server.base}${ADMIN}/`);
    await page.locator('k-forms-admin-forms k-table').waitFor();
    await page.getByText('Contact us').first().waitFor();
    await shot(page, 'admin-forms');

    await page.goto(`${state.server.base}${ADMIN}/form/?id=${state.formId}`);
    await page.locator('k-forms-admin-form k-sortable').waitFor();
    if(await page.locator('k-forms-admin-form k-sortable-item').count() !== FIELDS.length) return fail('every field is listed');
    await shot(page, 'admin-editor-fields');

    for(const name of ['form', 'notifications', 'spam', 'place']){
      await page.locator(`k-forms-admin-form k-tab[for="${name}"]`).click();
      await page.waitForTimeout(300);
      await shot(page, `admin-editor-${name}`);
    }

    await page.locator('k-forms-admin-form k-tab[for="form"]').click();
    await page.locator('k-forms-admin-form k-tab-content[name="form"] input[type="text"]').first().fill('Contact us (edited)');
    await page.getByRole('button', { name: 'Save form' }).click();
    await page.getByText('Form saved').waitFor();
    const { data } = await api('GET', `/kempo-forms/forms/${state.formId}`, 'editor');
    if(data.form.title !== 'Contact us (edited)') return fail(`the title is ${data.form.title}`);
    if(state.errors.length > start) return fail(state.errors.slice(start).join('\n'));
    await page.context().close();
    pass('');
  },

  'a condition is set from the editor, and dragging a field above its source takes it off': async ({ pass, fail }) => {
    const created = await api('POST', '/kempo-forms/forms', 'editor', {
      title: 'Conditions', slug: 'conditions',
      fields: [
        { key: 'how', label: 'How to reach you', type: 'radio', options: ['Phone', 'Email'] },
        { key: 'phone', label: 'Phone number', type: 'tel' },
        { key: 'note', label: 'A note', type: 'text' },
      ],
    });
    if(created.status !== 201) return fail(JSON.stringify(created.data));
    const id = created.data.form.id;

    const page = await newPage('editor');
    await page.goto(`${state.server.base}${ADMIN}/form/?id=${id}`);
    await page.locator('k-forms-admin-form k-sortable').waitFor();

    await page.locator('k-forms-admin-form k-accordion-header', { hasText: 'Phone number' }).click();
    const panel = page.locator('k-forms-admin-form k-accordion-panel[active]').first();
    await panel.getByLabel('Field to look at').selectOption('how');
    await panel.getByLabel('Comparison').waitFor();
    await panel.getByLabel('Value').selectOption('Phone');
    await page.waitForTimeout(400);
    if(!await panel.getByLabel('Value').isVisible()) return fail('the panel of a field closed itself while it was being edited');
    await shot(page, 'admin-editor-condition');
    await page.getByRole('button', { name: 'Save form' }).click();
    await page.getByText('Form saved').first().waitFor();

    const saved = (await api('GET', `/kempo-forms/forms/${id}`, 'editor')).data.form;
    const condition = saved.fields.find(field => field.key === 'phone').showWhen;
    if(condition?.key !== 'how' || condition.operator !== 'equals' || condition.value !== 'Phone') return fail(`saved condition ${JSON.stringify(condition)}`);

    /* Drag "Phone number" (second) above "How to reach you" (first): it can no longer depend on a field below it. */
    const handle = page.locator('k-forms-admin-form k-sortable-item').nth(1).locator('#handle');
    const target = await page.locator('k-forms-admin-form k-sortable-item').nth(0).boundingBox();
    const from = await handle.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, target.y + 4, { steps: 8 });
    await page.mouse.up();
    await page.getByText('condition removed').first().waitFor();
    const labels = await page.locator('k-forms-admin-form k-accordion-header').allInnerTexts();
    if(!labels[0].includes('Phone number')) return fail(`the field did not move: ${labels}`);
    await page.getByRole('button', { name: 'Save form' }).click();
    await page.getByText('Form saved').first().waitFor();

    const after = (await api('GET', `/kempo-forms/forms/${id}`, 'editor')).data.form;
    if(after.fields[0].key !== 'phone' || after.fields[0].showWhen) return fail(`saved order/condition ${JSON.stringify(after.fields.map(field => [field.key, field.showWhen]))}`);
    await page.context().close();
    pass('');
  },

  'a new form is made in the editor, with a field added and a condition set': async ({ pass, fail }) => {
    const page = await newPage('editor');
    await page.goto(`${state.server.base}${ADMIN}/form/`);
    await page.locator('k-forms-admin-form k-sortable').waitFor();
    await page.locator('k-forms-admin-form k-tab[for="form"]').click();
    await page.locator('k-forms-admin-form k-tab-content[name="form"] input[type="text"]').first().fill('Made in the browser');
    await page.locator('k-forms-admin-form k-tab[for="fields"]').click();
    await page.getByRole('button', { name: 'Add field' }).click();
    if(await page.locator('k-forms-admin-form k-sortable-item').count() !== 4) return fail('the new field is added');
    await shot(page, 'admin-editor-new');
    await page.getByRole('button', { name: 'Save form' }).click();
    await page.waitForURL(/form\/\?id=/);
    await page.locator('k-forms-admin-form k-sortable').waitFor();

    const found = await db.select().from(kempoFormsForm).where(eq(kempoFormsForm.slug, 'made-in-the-browser'));
    if(found.length !== 1 || found[0].fields.length !== 4) return fail('the form was saved with four fields');
    await page.context().close();
    pass('');
  },

  'submissions are listed, opened, flagged, trashed and restored': async ({ pass, fail }) => {
    const start = state.errors.length;
    const page = await newPage('support');
    await page.goto(`${state.server.base}${ADMIN}/submissions/`);
    await page.locator('k-forms-admin-submissions k-table').waitFor();
    await page.getByText('Ada Lovelace').first().waitFor();
    await shot(page, 'admin-submissions');

    await page.getByText('Ada Lovelace').first().click();
    await page.waitForURL(/submission\/\?id=/);
    await page.locator('k-forms-admin-submission').getByText('What was sent').waitFor();
    await page.locator('k-forms-admin-submission').getByText('ada@example.com').first().waitFor();
    await shot(page, 'admin-submission');
    const id = new URL(page.url()).searchParams.get('id');

    await page.getByRole('button', { name: 'This is spam' }).click();
    await page.getByText('Marked as spam').first().waitFor();
    await page.getByRole('button', { name: 'This is not spam' }).waitFor();
    await page.getByRole('button', { name: 'This is not spam' }).click();
    await page.getByText('Moved out of spam').first().waitFor();

    await page.getByRole('button', { name: 'Add note' }).waitFor({ state: 'attached' });
    await page.locator('k-forms-admin-submission textarea').fill('Called back');
    await page.getByRole('button', { name: 'Add note' }).click();
    await page.getByText('Called back').first().waitFor();

    await page.getByRole('button', { name: 'Move to the Trash' }).click();
    await page.getByText('Moved to the Trash').first().waitFor();
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.getByText('Restored').first().waitFor();

    const { data } = await api('GET', `/kempo-forms/submissions/${id}`, 'support');
    const types = data.submission.events.map(event => event.type);
    for(const expected of ['created', 'read', 'status_changed', 'note', 'trashed', 'restored']){
      if(!types.includes(expected)) return fail(`the history lacks "${expected}": ${types}`);
    }
    if(state.errors.length > start) return fail(state.errors.slice(start).join('\n'));
    await page.context().close();
    pass('');
  },

  'with an email extension installed, a submission is really emailed, and the visitor is confirmed to': needs('kempo-smtp', async ({ pass, fail }) => {
    const { SMTPServer } = await import('smtp-server');
    const { setSetting } = await import('kempo/server/sdk.js');
    const messages = [];
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onData: (stream, session, done) => {
        let raw = '';
        stream.on('data', chunk => {
          raw += chunk;
        });
        stream.on('end', () => {
          messages.push({ raw, to: session.envelope.rcptTo.map(entry => entry.address) });
          done();
        });
      },
    });
    const port = await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.server.address().port)));

    try {
      await setSetting('kempo-smtp', 'smtp_host', '127.0.0.1', 'string', false, null);
      await setSetting('kempo-smtp', 'smtp_port', port, 'number', false, null);
      await setSetting('kempo-smtp', 'smtp_secure', false, 'boolean', false, null);

      const on = await api('PUT', '/kempo-forms/settings', 'admin', { email_notifications: true });
      if(on.status !== 200) return fail(`with an email extension the switch must turn on: ${on.status} ${JSON.stringify(on.data)}`);

      const changed = await api('PUT', `/kempo-forms/forms/${state.formId}`, 'editor', {
        notifyEmails: ['owner@example.com'], useDefaultRecipients: false, sendConfirmation: true, confirmationField: 'address', confirmationSubject: 'Thanks, we got it', confirmationMessage: 'We reply within two days.',
      });
      if(changed.status !== 200) return fail(`could not set up the form: ${JSON.stringify(changed.data)}`);

      const sent = await api('POST', '/forms/contact-us/submit', null, { values: { name: '<b>Ada</b>', how: 'Email', address: 'ada@example.com' }, extras: {} });
      if(sent.status !== 201) return fail(`${sent.status} ${JSON.stringify(sent.data)}`);

      for(let attempt = 0; attempt < 100 && messages.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
      if(messages.length !== 2) return fail(`the SMTP server received ${messages.length} messages, not 2`);

      const notification = messages.find(message => message.to.includes('owner@example.com'));
      const confirmation = messages.find(message => message.to.includes('ada@example.com'));
      if(!notification || !confirmation) return fail(`recipients ${messages.map(message => message.to)}`);
      if(!/Subject: New submission: /.test(notification.raw)) return fail('the notification has the title of the form in its subject');
      /* The plain-text part of the message is made from the HTML by kempo-smtp and shows what was typed as it was typed. It is the HTML part that must hold it escaped. */
      const htmlPart = notification.raw.slice(notification.raw.search(/Content-Type: text\/html/i)).replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
      if(htmlPart.includes('<b>Ada</b>') || !htmlPart.includes('&lt;b&gt;Ada&lt;/b&gt;')) return fail('what the visitor typed must be escaped in the HTML of the email');
      if(!notification.raw.includes('ada@example.com')) return fail('the answers of the visitor are in it');
      if(!/^Reply-To: ada@example\.com\r?$/m.test(notification.raw)) return fail('the notification must carry the visitor\'s address as its Reply-To header');
      if(/^Reply-To:/im.test(confirmation.raw)) return fail('the confirmation to the visitor must have no Reply-To');
      if(!/Subject: Thanks, we got it/.test(confirmation.raw) || !confirmation.raw.includes('We reply within two days.')) return fail('the visitor is sent the confirmation of the form');

      const list = await api('GET', '/kempo-forms/submissions?search=ada@example.com', 'admin');
      const found = list.data.items.find(item => item.formSlug === 'contact-us' && item.values.address === 'ada@example.com');
      const detail = await api('GET', `/kempo-forms/submissions/${found.id}`, 'admin');
      const events = detail.data.submission.events;
      if(!events.some(event => event.type === 'notified' && event.data.ok === true && event.data.recipient === 'owner@example.com')) return fail('the history records the email to the owner');
      const confirmed = events.find(event => event.type === 'confirmation');
      if(confirmed?.data.ok !== true) return fail('and the confirmation');
      if(JSON.stringify(confirmed.data).includes('ada@example.com')) return fail('the confirmation event must not hold the address of the visitor');
      pass(`${messages.length} messages delivered`);
    } finally {
      await api('PUT', '/kempo-forms/settings', 'admin', { email_notifications: false });
      await new Promise(resolve => server.close(resolve));
    }
  }),

  'the settings load, save, and the erase tool finds a person': async ({ pass, fail }) => {
    const start = state.errors.length;
    const page = await newPage('admin');
    await page.goto(`${state.server.base}${ADMIN}/#settings`);
    await page.locator('k-forms-admin-settings k-accordion-header[for-panel="general"]').waitFor();
    await shot(page, 'admin-settings-general');

    await page.locator('k-forms-admin-settings k-accordion-header[for-panel="privacy"]').click();
    await page.locator('k-forms-admin-settings k-accordion-panel[name="privacy"] input[type="number"]').first().waitFor();
    await page.locator('k-forms-admin-settings k-accordion-panel[name="privacy"] input[type="number"]').first().fill('90');
    await page.locator('k-forms-admin-settings k-accordion-panel[name="privacy"]').getByRole('button', { name: 'Save' }).click();
    await page.getByText('Settings saved').waitFor();

    await page.getByRole('button', { name: 'Find a person\'s data' }).click();
    await page.locator('#forms-person').fill('ada@example.com');
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await page.getByText('about ada@example.com').waitFor();
    if(await page.locator('#forms-person').count()) return fail('the dialog that asks for the address should have been replaced by the one with the result');
    await shot(page, 'admin-settings-privacy');
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    await page.locator('k-forms-admin-settings k-accordion-header[for-panel="spam"]').click();
    await page.getByRole('button', { name: 'Add a rule' }).click();
    await page.locator('k-forms-admin-rules input[type="text"]').nth(1).fill('bitcoin');
    await page.locator('k-forms-admin-rules textarea').fill('buy bitcoin now');
    await page.getByRole('button', { name: 'Test', exact: true }).click();
    await page.getByText('Matched:').waitFor();
    await shot(page, 'admin-settings-spam');

    const { data } = await api('GET', '/kempo-forms/settings', 'admin');
    if(data.settings.find(setting => setting.name === 'retention_days').value !== 90) return fail('the retention was saved');
    if(state.errors.length > start) return fail(state.errors.slice(start).join('\n'));
    await page.context().close();
    pass('');
  },

  'the dashboard widget and the Trash tab load': async ({ pass, fail }) => {
    const page = await newPage('admin');
    await page.goto(`${state.server.base}${ADMIN}/`);
    await page.locator('k-forms-admin-forms k-table').waitFor();
    await page.locator('k-tab[for="trash"]').click();
    await page.locator('k-forms-admin-trash').waitFor();
    await shot(page, 'admin-trash');

    const { status, data } = await api('GET', '/kempo-forms/summary', 'admin');
    if(status !== 200 || typeof data.unread !== 'number') return fail(`the summary: ${status} ${JSON.stringify(data)}`);
    await page.context().close();
    pass('');
  },

  'the widget is drawn on the admin dashboard with the numbers of the summary and a link to the submissions': async ({ pass, fail }) => {
    const start = state.errors.length;
    const { data } = await api('GET', '/kempo-forms/summary', 'admin');
    const page = await newPage('admin');
    await page.goto(`${state.server.base}/admin/`);
    const widget = page.locator('k-forms-widget');
    await widget.waitFor();
    await widget.getByText('Unread').waitFor();
    await shot(page, 'admin-dashboard');
    const text = (await widget.innerText()).replace(/\s+/g, ' ');
    for(const [label, value] of [['Today', data.today], ['This week', data.week], ['Unread', data.unread]]){
      if(!new RegExp(`${value} ${label}`).test(text)) return fail(`the widget says "${text}", expected ${value} ${label}`);
    }
    const link = await widget.getByRole('link', { name: /View submissions/ }).getAttribute('href');
    if(link !== '/admin/extension/kempo-forms/submissions/') return fail(`the widget links to ${link}`);
    if(state.errors.length > start) return fail(state.errors.slice(start).join('\n'));
    await page.context().close();
    pass(text);
  },

  'no console error was raised anywhere': async ({ pass, fail }) => {
    if(state.errors.length) return fail(`\n    ${state.errors.join('\n    ')}`);
    pass('');
  },

  'the browser is closed and the site’s server stopped': async ({ pass }) => {
    await state.browser?.close();
    stopServer(state.server);
    await purgeSite({ users: USERS, extensions: ['kempo-forms', 'kempo-files', 'kempo-smtp'] });
    await purge();
    pass(`screenshots in ${screensDir}`);
  },
};

/*
  A case that throws — a locator that timed out, usually — leaves a screenshot of where it got to, named after the case, and its
  page is closed so the next case starts clean.
*/
const guarded = Object.fromEntries(Object.entries(tests).map(([name, run], index) => [name, async helpers => {
  try {
    return await run(helpers);
  } catch(error) {
    if(state.page && !state.page.isClosed()){
      await shot(state.page, `failed-${index + 1}`).catch(() => {});
      await state.page.context().close().catch(() => {});
    }
    return helpers.fail(`${error.message.split('\n')[0]} — screenshot: failed-${index + 1}.png`);
  }
}]));

export default integrationTier ? guarded : integrationOnly('browser');
