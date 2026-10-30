import exportCsv from '../../../../../server/utils/submissions/csv.js';
import { gate, refuse } from '../../../../../server/http/gate.js';

/* The submissions matching the same filters as the list, as a CSV file. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:view');
  if(gateError) return refuse(response, gateError);

  const { form, status, search, from, to } = request.query || {};
  const csv = await exportCsv({ formId: form, status, search, from, to });
  response.set('Content-Type', 'text/csv; charset=utf-8');
  response.set('Content-Disposition', 'attachment; filename="submissions.csv"');
  response.send(csv);
};
