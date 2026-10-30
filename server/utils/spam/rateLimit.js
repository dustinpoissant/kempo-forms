import crypto from 'crypto';
import { and, eq, gte, lt } from 'drizzle-orm';
import { getSetting, setSetting } from 'kempo/server/sdk.js';
import db from 'kempo/server/db/index.js';
import { kempoFormsAttempt } from '../../db/schema.js';
import { newId } from '../ids.js';
import { OWNER } from '../config/settings.js';

/*
  The rate limit: how many times one visitor has tried to submit in the last hour, whether or not the attempt was accepted, so a
  bot that keeps trying is limited even when its submissions are flagged.

  Visitors are told apart by a salted hash of their address. The salt is made once per site and kept in the settings, so the
  hashes mean nothing outside this site, and nothing here can be turned back into an address.

  **Insert first, then count.** An attempt is recorded before it is counted, so of any number of simultaneous attempts the
  later ones always see the earlier ones. A burst at the edge of the limit may refuse a request that would have fitted, but it
  can never let one through that should not have been.
*/

const HOUR = 60 * 60 * 1000;

/*
  Made the first time it is needed, then kept for the life of the process. Simultaneous first attempts must all end up with the
  same salt, or their hashes would differ and the limit would count each of them as a different visitor, so they share one
  lookup-or-creation. A changed salt takes effect when the server next starts.
*/
let known = null;

const saltOf = () => known ||= (async () => {
  const [, existing] = await getSetting(OWNER, 'ip_salt', '');
  if(typeof existing === 'string' && existing.length >= 32) return existing;
  const salt = crypto.randomBytes(32).toString('hex');
  await setSetting(OWNER, 'ip_salt', salt, 'string', false, 'Used to hash visitor addresses for the rate limit. Made automatically; changing it only resets the counts');
  return salt;
})().catch(error => {
  known = null;
  throw error;
});

export const hashOf = async value => crypto.createHash('sha256').update(`${await saltOf()}:${value}`).digest('hex');

/*
  `[null, { hash }]` when the attempt may go ahead, `[{ code: 429, msg, retryAfter }, null]` when this visitor is over the limit.
  With no address, or the limit off, nothing is recorded and the attempt goes ahead.
*/
export const recordAttempt = async ({ ip, limit, bytes = 0 }) => {
  if(!ip || !limit) return [null, { hash: null }];

  const hash = await hashOf(ip);
  const now = new Date();
  await db.insert(kempoFormsAttempt).values({ id: newId(), ipHash: hash, at: now, bytes });

  const since = new Date(now.getTime() - HOUR);
  const rows = await db.select({ at: kempoFormsAttempt.at }).from(kempoFormsAttempt)
    .where(and(eq(kempoFormsAttempt.ipHash, hash), gte(kempoFormsAttempt.at, since)));

  if(rows.length > limit){
    const oldest = rows.reduce((earliest, row) => row.at < earliest ? row.at : earliest, now);
    const retryAfter = Math.max(1, Math.ceil((oldest.getTime() + HOUR - now.getTime()) / 1000));
    return [{ code: 429, msg: 'You have tried too many times. Please wait a while and try again.', retryAfter }, null];
  }
  return [null, { hash }];
};

export const pruneAttempts = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - 24 * HOUR);
  const removed = await db.delete(kempoFormsAttempt).where(lt(kempoFormsAttempt.at, cutoff)).returning({ id: kempoFormsAttempt.id });
  return removed.length;
};
