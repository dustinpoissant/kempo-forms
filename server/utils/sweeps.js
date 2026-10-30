import { and, eq, lt } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsSubmission } from '../db/schema.js';
import { readConfig } from './config/settings.js';
import { pruneAttempts } from './spam/rateLimit.js';
import { purgeSubmissions } from './submissions/manage.js';
import { retryErasures } from './privacy/erase.js';

/*
  The work that runs every minute (jobs/sweep.js): retries erasure requests that did not finish, removes submissions past the
  retention the site chose (spam on its own, shorter clock), and forgets the rate-limit attempts older than a day.

  Each run removes at most BATCH submissions of each kind, so a site that turns retention on for years of backlog is cleared over
  several minutes instead of in one long request.
*/

const BATCH = 200;
const DAY = 24 * 60 * 60 * 1000;

const expired = async (days, filter, now) => {
  if(!days) return 0;
  const cutoff = new Date(now.getTime() - days * DAY);
  const rows = await db.select({ id: kempoFormsSubmission.id }).from(kempoFormsSubmission).where(and(lt(kempoFormsSubmission.createdAt, cutoff), filter)).limit(BATCH);
  const [, result] = await purgeSubmissions({ ids: rows.map(row => row.id), actor: 'retention' });
  return result?.purged ?? 0;
};

export const runSweep = async (now = new Date()) => {
  const config = await readConfig();
  const erased = await retryErasures();
  const spam = await expired(config.spamRetentionDays, eq(kempoFormsSubmission.status, 'spam'), now);
  const old = await expired(config.retentionDays, undefined, now);
  const attempts = await pruneAttempts(now);
  return { erased, spam, old, attempts };
};
