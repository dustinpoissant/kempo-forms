import { createNotification } from 'kempo/server/sdk.js';
import { countByStatus } from '../submissions/read.js';

const OWNER = 'kempo-forms';
const PERMISSION = 'forms:submissions:view';
const ADMIN_URL = '/admin/extension/kempo-forms';

/*
  Tells the people who read submissions that one arrived, in the admin and without email, so it works with no email
  extension installed. One notice per form, not one per submission: a busy form would otherwise bury everything else.
  It is raised again (and re-opened for everyone, with the count) each time another submission comes in, and the count is
  what is still marked new, so it falls as the submissions are read. Spam is never announced.

  Never throws: a notification problem must not turn into a lost submission.
*/
export default async ({ submission, form }) => {
  try {
    if(submission.status !== 'new') return;

    const { new: waiting } = await countByStatus({ formId: form.id });
    const [error] = await createNotification({
      owner: OWNER,
      type: 'notice',
      subtype: 'info',
      title: `New submission: ${form.title}`.slice(0, 200),
      message: waiting > 1 ? `${waiting} submissions are waiting to be read.` : 'A new submission is waiting to be read.',
      permission: PERMISSION,
      dedupeKey: `new-submission:${form.id}`,
      actions: [{ label: waiting > 1 ? 'View submissions' : 'View submission', href: waiting > 1 ? `${ADMIN_URL}/submissions/` : `${ADMIN_URL}/submission/?id=${encodeURIComponent(submission.id)}` }],
    });
    if(error) console.error(`[kempo-forms] Could not raise a notification: ${error.msg}`);
  } catch(error) {
    console.error(`[kempo-forms] Could not raise a notification: ${error?.message ?? error}`);
  }
};
