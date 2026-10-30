import { getSession, currentUserHasPermission } from 'kempo/server/sdk.js';
import { readConfig } from '../utils/config/settings.js';

/*
  The HTTP layer's own helpers — who is asking, and are they allowed. They live here rather than in server/utils because they
  read requests, and nothing under server/utils does.

  Routes come in two kinds, and each says which it is by what it calls:

  - **Public.** Showing a form and sending one need no permission and no session. The visitor is signed in only if they happen to
    be, which is what a form that requires an account and the `userId` kept with a submission rely on.
  - **Administrative.** Every other route needs its own `forms:*` permission, checked here, and that check is the boundary:
    the admin pages only hide what a user cannot use.
*/

export const optionalSession = async request => {
  const token = request.cookies?.session_token;
  if(!token) return null;
  const [error, session] = await getSession({ token });
  return error || !session?.user ? null : { token, user: session.user };
};

export const requireSession = async request => {
  const session = await optionalSession(request);
  return session ? [null, session] : [{ code: 401, msg: 'Sign in first' }, null];
};

export const gate = async (request, permission) => {
  const [sessionError, session] = await requireSession(request);
  if(sessionError) return [sessionError, null];

  const [error, allowed] = await currentUserHasPermission(session.token, permission);
  if(error) return [{ code: error.code, msg: error.msg }, null];
  if(!allowed) return [{ code: 403, msg: 'You do not have permission to do that' }, null];

  return [null, session];
};

/*
  Allowed when the user holds any one of the permissions.
*/
export const gateAny = async (request, permissions) => {
  let last = null;
  for(const permission of permissions){
    const [error, session] = await gate(request, permission);
    if(!error) return [null, session];
    last = error;
    if(error.code === 401) break;
  }
  return [last, null];
};

/*
  Sends an error tuple's error. The extra fields a refusal carries — the errors for each field, how long to wait — go to the
  caller too, since they are what a page needs to say something useful.
*/
export const refuse = (response, { code, msg, ...details }) => {
  if(details.retryAfter) response.set('Retry-After', String(details.retryAfter));
  return response.status(code || 500).json({ error: msg, ...details });
};

/*
  The JSON body of a request as an object, or {} when there is none or it is not one.
*/
export const body = request => request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body : {};

/*
  The visitor's address, for the rate limit. Behind a proxy every visitor shares the proxy's address, so `trust_proxy` takes it
  from X-Forwarded-For instead — and only then: with no proxy that header is whatever the visitor sent.
*/
export const clientIp = async request => {
  const config = await readConfig();
  if(config.trustProxy){
    const forwarded = String(request.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    if(forwarded) return forwarded;
  }
  return request._originalRequest?.socket?.remoteAddress || request.socket?.remoteAddress || null;
};

/*
  An array of ids from a JSON body, or [] when it is not one.
*/
export const ids = value => Array.isArray(value) ? value.map(String).slice(0, 1000) : [];
