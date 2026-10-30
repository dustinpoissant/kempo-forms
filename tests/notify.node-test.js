import { cp, mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { eq } from 'drizzle-orm';
import { email } from 'kempo/server/db/schema.js';
import { kempoFormsSubmission, kempoFormsSubmissionEvent } from '../server/db/schema.js';
import { resendNotification, setSubmissionStatus } from '../server/utils/submissions/manage.js';
import { validateSettings } from '../server/utils/config/validate.js';
import { ADA, db, handle, heard, listen, makeForm, purge, send, stopListening, withSettings } from './helpers/forms.js';
import { seedDatabase } from './helpers/db.js';

/*
  Emails: who is told about a submission, what the message says, and that a failure never loses a submission. A hook stands in
  for the email extension (kempo-resend or kempo-smtp), so nothing is really sent, but everything else is real: the log, the
  retry bookkeeping and the template rendering. The templates render from a folder laid out like a site's node_modules.
*/

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const originalCwd = process.cwd();
let site;
let sent;

export const beforeAll = async () => {
  await seedDatabase();
  await purge();
  site = await mkdtemp(path.join(os.tmpdir(), 'kempo-forms-site-'));
  await mkdir(path.join(site, 'node_modules', 'kempo-forms'), { recursive: true });
  await cp(path.join(root, 'emails'), path.join(site, 'node_modules', 'kempo-forms', 'emails'), { recursive: true });
  process.chdir(site);
};

export const afterAll = async () => {
  process.chdir(originalCwd);
  await rm(site, { recursive: true, force: true });
  await stopListening();
  await purge();
};

const reset = async () => {
  await purge();
  await listen(['email:send', 'kempo-forms:submission:notify', 'kempo-forms:email:context', 'kempo-forms:submission:sent']);
  sent = [];
  handle('email:send', ({ email: message }) => {
    sent.push(message);
    return { sent: true, provider: 'test' };
  });
};

const on = run => withSettings([['email_notifications', true, 'boolean'], ['default_recipients', 'owner@example.com, Team@example.com', 'string'], ['site_url', 'https://example.org', 'string']], run);

const eventsOf = async id => db.select().from(kempoFormsSubmissionEvent).where(eq(kempoFormsSubmissionEvent.submissionId, id));

export default {
  'a submission is emailed to the form\'s recipients and the site-wide ones, once each': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com', 'team@example.com'] });
    await on(() => send(form, ADA));
    const recipients = sent.map(message => message.to).sort();
    if(recipients.join() !== 'owner@example.com,sales@example.com,team@example.com') return fail(`got ${recipients}`);
    pass('');
  },

  'the message names the form, shows every answer escaped, and links to the admin': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ title: 'Contact <us>' });
    await on(() => send(form, { ...ADA, name: '<script>alert(1)</script>', message: 'Line one\nLine two' }));
    const message = sent[0];
    if(message.subject !== 'New submission: Contact <us>') return fail(`subject ${message.subject}`);
    if(message.html.includes('<script>alert')) return fail('a visitor\'s markup must be escaped in the email');
    if(!message.html.includes('&lt;script&gt;')) return fail('and it is shown as text');
    if(!message.html.includes('Line one<br>Line two')) return fail('line breaks show');
    if(!message.html.includes('Contact &lt;us&gt;')) return fail('the title is escaped too');
    const [{ id }] = await db.select().from(kempoFormsSubmission);
    if(!message.html.includes(`https://example.org/admin/extension/kempo-forms/submission/?id=${id}`)) return fail('the link opens the submission');
    if(!message.html.includes('mailto:ada@example.com')) return fail('the visitor\'s address is offered to reply to');
    pass('');
  },

  'a notification replies to the visitor, and the visitor\'s own confirmation does not': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com'], sendConfirmation: true, confirmationField: 'email' });
    await on(() => send(form, { ...ADA, email: "o'brien+forms@example.com" }));
    const note = sent.find(message => message.to === 'sales@example.com');
    const receipt = sent.find(message => message.to === "o'brien+forms@example.com");
    if(note?.replyTo !== "o'brien+forms@example.com") return fail(`the notification replies to ${JSON.stringify(note?.replyTo)}`);
    if(!receipt || receipt.replyTo !== null) return fail(`the confirmation has reply-to ${JSON.stringify(receipt?.replyTo)}`);
    const [saved] = await db.select().from(email).where(eq(email.recipient, 'sales@example.com'));
    if(saved?.replyTo !== "o'brien+forms@example.com") return fail('the log did not keep the reply-to');
    pass('');
  },

  'markdown answers are rendered and cleaned in the email': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ fields: [{ key: 'about', label: 'About', type: 'markdown' }] });
    await withSettings([['email_notifications', true, 'boolean'], ['default_recipients', 'o@example.com', 'string'], ['rich_text', 'markdown', 'string']], () =>
      send(form, { about: '**bold** <script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.com)' }));
    const html = sent[0].html;
    if(!html.includes('<strong>bold</strong>')) return fail('markdown is rendered');
    if(/<script|javascript:/i.test(html)) return fail(`the email holds something unsafe`);
    if(!html.includes('href="https://example.com"')) return fail('a safe link stays');
    pass('');
  },

  'nothing is sent while email notifications are off, and the submission is still saved': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com'] });
    const [error] = await send(form, ADA);
    if(error) return fail(error.msg);
    if(sent.length || (await db.select().from(email)).length) return fail('nothing is queued');
    if((await db.select().from(kempoFormsSubmission)).length !== 1) return fail('the submission is saved');
    pass('');
  },

  'a form can leave out the site-wide recipients': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com'], useDefaultRecipients: false });
    await on(() => send(form, ADA));
    if(sent.map(message => message.to).join() !== 'sales@example.com') return fail(`got ${sent.map(message => message.to)}`);
    pass('');
  },

  'spam is never emailed': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com'] });
    await on(() => send(form, ADA, { extras: { website_url: 'x' } }));
    if(sent.length) return fail('a flagged submission is not emailed');
    pass('');
  },

  'marking spam as not spam sends the notifications it never got': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com'], useDefaultRecipients: false });
    await on(async () => {
      const [, result] = await send(form, ADA, { extras: { website_url: 'x' } });
      if(sent.length) return fail('not emailed while spam');
      await setSubmissionStatus({ id: result.id, status: 'new', reason: 'Real' });
    });
    if(sent.length !== 1) return fail('emailed once it is a real one');
    pass('');
  },

  'a hook can add and remove recipients, or refuse the notification': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com'], useDefaultRecipients: false });
    handle('kempo-forms:submission:notify', payload => {
      payload.recipients = payload.recipients.filter(address => address !== 'sales@example.com');
      payload.recipients.push('chat-bridge@example.com');
    });
    await on(() => send(form, ADA));
    if(sent.map(message => message.to).join() !== 'chat-bridge@example.com') return fail(`got ${sent.map(message => message.to)}`);

    sent.length = 0;
    handle('kempo-forms:submission:notify', () => {
      throw { code: 403, msg: 'Quiet hours' };
    });
    const [, result] = await on(() => send(form, ADA));
    if(sent.length) return fail('a refusal sends nothing');
    const refused = (await eventsOf(result.id)).find(event => event.type === 'notified');
    if(refused.data.ok !== false || refused.data.error !== 'Quiet hours') return fail('the refusal is in the history');
    pass('');
  },

  'a hook can add to what the template shows': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com'], useDefaultRecipients: false });
    handle('kempo-forms:email:context', ({ context }) => {
      context.rows.push({ label: 'Lead score', html: '87' });
    });
    await on(() => send(form, ADA));
    if(!sent[0].html.includes('Lead score') || !sent[0].html.includes('87')) return fail('the extra row is in the email');
    pass('');
  },

  'every recipient\'s result is in the history, and a failure never loses the submission': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['good@example.com', 'bad@example.com'], useDefaultRecipients: false });
    handle('email:send', ({ email: message }) => message.to === 'bad@example.com' ? { sent: false, error: 'Mailbox full' } : { sent: true, provider: 'test' });
    const [error, result] = await on(() => send(form, ADA));
    if(error) return fail('the visitor is not told about an email problem');
    const notified = (await eventsOf(result.id)).filter(event => event.type === 'notified').map(event => event.data);
    const bad = notified.find(entry => entry.recipient === 'bad@example.com');
    const good = notified.find(entry => entry.recipient === 'good@example.com');
    if(good?.ok !== true || bad?.ok !== false || !bad.error.includes('Mailbox full')) return fail(`history ${JSON.stringify(notified)}`);
    if(heard('kempo-forms:submission:sent').length !== 2) return fail('submission:sent fires per recipient');
    pass('');
  },

  'with no email extension installed, the submission is saved and the failure recorded': async ({ pass, fail }) => {
    await reset();
    await stopListening();
    const form = await makeForm({ notifyEmails: ['sales@example.com'], useDefaultRecipients: false });
    const [error, result] = await on(() => send(form, ADA));
    if(error) return fail('the visitor is not affected');
    const notified = (await eventsOf(result.id)).find(event => event.type === 'notified');
    if(notified.data.ok !== false) return fail('the failure is recorded');
    pass('');
  },

  'a confirmation goes to the visitor, never to the site, and the history never holds their address': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({
      notifyEmails: ['sales@example.com'],
      useDefaultRecipients: false,
      sendConfirmation: true,
      confirmationField: 'email',
      confirmationSubject: 'Thanks, we got it',
      confirmationMessage: 'We reply within two days.\nTalk soon',
    });
    const [, result] = await on(() => send(form, ADA));
    const confirmation = sent.find(message => message.to === 'ada@example.com');
    if(!confirmation || confirmation.subject !== 'Thanks, we got it') return fail('the visitor is emailed with the form\'s subject');
    if(!confirmation.html.includes('We reply within two days.<br>Talk soon')) return fail('the form\'s message is in it');
    const events = await eventsOf(result.id);
    if(JSON.stringify(events).includes('ada@example.com')) return fail('the history must not hold the visitor\'s address');
    if(!events.some(event => event.type === 'confirmation' && event.data.ok === true)) return fail('but records that it was sent');
    pass('');
  },

  'no confirmation without the form asking, for spam, or with notifications off': async ({ pass, fail }) => {
    await reset();
    const plain = await makeForm({ useDefaultRecipients: false });
    const asking = await makeForm({ useDefaultRecipients: false, sendConfirmation: true, confirmationField: 'email' });
    await on(async () => {
      await send(plain, ADA);
      await send(asking, ADA, { extras: { website_url: 'x' } });
    });
    await send(asking, ADA);
    if(sent.length) return fail(`unexpected ${sent.map(message => message.to)}`);
    pass('');
  },

  'resending sends again, and refuses spam, the Trash and notifications that are off': async ({ pass, fail }) => {
    await reset();
    const form = await makeForm({ notifyEmails: ['sales@example.com'], useDefaultRecipients: false });
    const [, result] = await on(() => send(form, ADA));
    sent.length = 0;
    const [off] = await resendNotification({ id: result.id });
    if(off?.code !== 409) return fail('off is refused');
    await on(() => resendNotification({ id: result.id }));
    if(sent.length !== 1) return fail('sent again');
    await setSubmissionStatus({ id: result.id, status: 'spam' });
    const [spam] = await on(() => resendNotification({ id: result.id }));
    if(spam?.code !== 409) return fail('spam is refused');
    pass('');
  },

  'email notifications can only be turned on once an email extension exists': async ({ pass, fail }) => {
    await reset();
    await stopListening();
    const [refused] = await validateSettings({ email_notifications: true });
    if(refused?.code !== 409) return fail('refused without a transport');
    const [offOk] = await validateSettings({ email_notifications: false });
    if(offOk) return fail('turning them off is always allowed');

    await listen(['email:send']);
    const [allowed, updates] = await validateSettings({ email_notifications: true, default_recipients: 'A@x.co, b@x.co' });
    if(allowed) return fail(allowed.msg);
    if(updates.default_recipients !== 'a@x.co, b@x.co') return fail('recipients are cleaned');
    pass('');
  },

  'settings validation names what is wrong': async ({ pass, fail }) => {
    const refuses = async (body, includes) => {
      const [error] = await validateSettings(body);
      return error && error.msg.includes(includes) ? null : `expected "${includes}" for ${JSON.stringify(body)}, got ${error ? error.msg : 'no error'}`;
    };
    const checks = [
      [{ nonsense: 1 }, 'not a forms setting'],
      [{ rate_limit_per_hour: 'ten' }, 'whole number'],
      [{ spam_action: 'maybe' }, 'one of'],
      [{ rich_text: 'bbcode' }, 'one of'],
      [{ default_recipients: 'nope' }, 'not a valid email'],
      [{ spam_rules: [{ pattern: '(a)\\1' }] }, 'cannot be used'],
      [{ store_ip: 'yes' }, 'on or off'],
      [{ site_url: 'example.com' }, 'http'],
      [{}, 'Nothing to save'],
    ];
    for(const [body, includes] of checks){
      const problem = await refuses(body, includes);
      if(problem) return fail(problem);
    }
    pass(`${checks.length} refusals`);
  },
};
