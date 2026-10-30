import { asc } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { kempoFormsForm } from '../../../../../server/db/schema.js';
import { gate, refuse } from '../../../../../server/http/gate.js';

/*
  The forms a submission can have come from, as just a title and an address, for the Form filter on the submissions screen. Someone
  who may read submissions but not edit forms needs this much and no more: no recipients, no rules.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:view');
  if(gateError) return refuse(response, gateError);

  const forms = await db.select({ id: kempoFormsForm.id, title: kempoFormsForm.title, slug: kempoFormsForm.slug, status: kempoFormsForm.status }).from(kempoFormsForm).orderBy(asc(kempoFormsForm.title));
  response.json({ forms });
};
