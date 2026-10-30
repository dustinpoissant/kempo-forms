import { findMatches } from '../../../../../server/utils/privacy/erase.js';
import { rowsToCsv } from '../../../../../server/utils/submissions/csv.js';
import { gate, refuse } from '../../../../../server/http/gate.js';

/* Everything held about an email address, as a CSV: the answer to a request to see one's data. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:view');
  if(gateError) return refuse(response, gateError);

  const email = String(request.query?.email ?? '');
  if(!email.trim()) return refuse(response, { code: 400, msg: 'Enter an email address.' });

  response.set('Content-Type', 'text/csv; charset=utf-8');
  response.set('Content-Disposition', 'attachment; filename="submissions-about-one-person.csv"');
  response.send(rowsToCsv(await findMatches({ email })));
};
