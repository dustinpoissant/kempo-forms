import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createUser, addUserToGroup, getNotifications, deleteUser } from 'kempo/server/sdk.js';
import { group, groupPermission, notification, permission } from 'kempo/server/db/schema.js';
import { setSubmissionStatus } from '../server/utils/submissions/manage.js';
import { ADA, db, makeForm, purge, send } from './helpers/forms.js';
import { seedDatabase } from './helpers/db.js';

/*
  What the people who read submissions are told when one comes in: a notice in the admin, rolled up per form, with no email
  extension needed. Spam is never announced.
*/

const PERMISSION = 'forms:submissions:view';
const GROUP = 'staff-notice-test:readers';
const OWNER = 'kempo-forms';
const state = { ids: {} };

const expect = (condition, message) => {
  if(!condition) throw new Error(message);
};

const noticesFor = async userId => {
  const [error, result] = await getNotifications({ userId, status: 'all', limit: 100 });
  expect(!error, `getNotifications: ${error?.msg}`);
  return result.notifications.filter(n => n.owner === OWNER);
};

const cleanUp = async () => {
  await db.delete(notification).where(eq(notification.owner, OWNER));
  await db.delete(groupPermission).where(eq(groupPermission.groupName, GROUP)).catch(() => {});
  await db.delete(group).where(eq(group.name, GROUP)).catch(() => {});
  for(const id of Object.values(state.ids)) await deleteUser(id).catch(() => {});
  await purge();
};

export const beforeAll = async () => {
  await seedDatabase();
  await cleanUp();
  state.ids = {};
  await db.insert(permission).values({ name: PERMISSION, description: 'test', owner: OWNER, createdAt: new Date() }).onConflictDoNothing();
  await db.insert(group).values({ name: GROUP, description: 'test', owner: 'staff-notice-test', createdAt: new Date() });
  await db.insert(groupPermission).values({ id: crypto.randomUUID(), groupName: GROUP, permissionName: PERMISSION, createdAt: new Date() });
  for(const name of ['reader', 'outsider']){
    const [error, created] = await createUser({ name, email: `staff-notice-${name}@test.local`, password: 'StaffNotice123!', emailVerified: true });
    expect(!error, `createUser ${name}: ${error?.msg}`);
    state.ids[name] = created.user.id;
  }
  expect(!(await addUserToGroup(state.ids.reader, GROUP))[0], 'the reader joins the group');
};

export const afterAll = cleanUp;

export default {
  'a new submission raises a notice for the people who can read submissions, linking to it': async ({ pass }) => {
    const form = await makeForm({ title: 'Contact us' });
    const [error, sent] = await send(form, ADA);
    expect(!error, `send: ${JSON.stringify(error)}`);

    const [notice, ...rest] = await noticesFor(state.ids.reader);
    expect(notice && rest.length === 0, 'one notification for the reader');
    expect(notice.type === 'notice' && notice.subtype === 'info' && notice.title === 'New submission: Contact us', `${notice.type}/${notice.subtype}/${notice.title}`);
    expect(notice.message === 'A new submission is waiting to be read.', notice.message);
    expect(notice.actions[0].href === `/admin/extension/kempo-forms/submission/?id=${sent.id}`, JSON.stringify(notice.actions));
    expect((await noticesFor(state.ids.outsider)).length === 0, 'and nobody without the permission');
    pass();
  },

  'more submissions to the same form refresh that notice with a count, and re-open it': async ({ pass }) => {
    await purge();
    await db.delete(notification).where(eq(notification.owner, OWNER));
    const form = await makeForm({ title: 'Support' });
    await send(form, ADA);
    const [first] = await noticesFor(state.ids.reader);
    await send(form, { ...ADA, message: 'Another' });
    await send(form, { ...ADA, message: 'And another' });

    const notices = await noticesFor(state.ids.reader);
    expect(notices.length === 1 && notices[0].id === first.id, `still one notification, got ${notices.length}`);
    expect(notices[0].message === '3 submissions are waiting to be read.', notices[0].message);
    expect(notices[0].actions[0].href === '/admin/extension/kempo-forms/submissions/', JSON.stringify(notices[0].actions));
    pass();
  },

  'each form has its own notice': async ({ pass }) => {
    await purge();
    await db.delete(notification).where(eq(notification.owner, OWNER));
    await send(await makeForm({ title: 'One' }), ADA);
    await send(await makeForm({ title: 'Two' }), ADA);
    expect((await noticesFor(state.ids.reader)).length === 2, 'two forms, two notices');
    pass();
  },

  'spam is never announced': async ({ pass }) => {
    await purge();
    await db.delete(notification).where(eq(notification.owner, OWNER));
    const form = await makeForm({ title: 'Spammed' });
    const [error] = await send(form, { ...ADA }, { extras: { website_url: 'http://spam.example' } });
    expect(!error, `send: ${JSON.stringify(error)}`);
    expect((await noticesFor(state.ids.reader)).length === 0, 'a spam submission raises nothing');
    pass();
  },

  'the count falls as submissions are read': async ({ pass }) => {
    await purge();
    await db.delete(notification).where(eq(notification.owner, OWNER));
    const form = await makeForm({ title: 'Counted' });
    const [, first] = await send(form, ADA);
    await send(form, { ...ADA, message: 'Second' });
    expect(!(await setSubmissionStatus({ id: first.id, status: 'read', actor: 'test' }))[0], 'read one');
    await send(form, { ...ADA, message: 'Third' });

    const [notice] = await noticesFor(state.ids.reader);
    expect(notice.message === '2 submissions are waiting to be read.', `the read one is not counted: ${notice.message}`);
    pass();
  },
};
