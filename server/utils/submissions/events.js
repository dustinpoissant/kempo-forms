import { asc, eq } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsSubmissionEvent } from '../../db/schema.js';
import { newId } from '../ids.js';

/*
  A submission's history. `data` must never hold a personal value: an erasure records the keys it removed, not what was in them.
*/
export const addEvent = async (submissionId, type, { actor = '', data = {} } = {}, runner = db) => {
  await runner.insert(kempoFormsSubmissionEvent).values({ id: newId(), submissionId, at: new Date(), actor, type, data });
};

export const listEvents = async submissionId => db.select().from(kempoFormsSubmissionEvent)
  .where(eq(kempoFormsSubmissionEvent.submissionId, submissionId))
  .orderBy(asc(kempoFormsSubmissionEvent.at), asc(kempoFormsSubmissionEvent.id));
