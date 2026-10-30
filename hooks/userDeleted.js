import { requestErasure } from '../server/utils/privacy/erase.js';

/*
  kempo deleted a user (an administrator did it, or the person did from their account page). Their submissions are erased of
  personal data, found by their account and by the email address they had. kempo does not retry a hook, so the request is
  written down first and the sweep finishes it if this fails. See server/utils/privacy/erase.js.
*/
export default async ({ id, email }) => {
  if(!id && !email) return;
  await requestErasure({ email: email ?? '', userId: id ?? '', source: 'account', actor: 'user:deleted' });
};
