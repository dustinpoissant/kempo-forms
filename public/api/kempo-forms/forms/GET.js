import { listForms } from '../../../../server/utils/forms/read.js';
import { gate, refuse } from '../../../../server/http/gate.js';

/* The forms, with their counts. `status` is live, paused or archived (the Trash); blank is every form that is not in the Trash. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:forms:view');
  if(gateError) return refuse(response, gateError);

  const { status, search, limit, offset } = request.query || {};
  const [error, result] = await listForms({ status, search, limit, offset });
  if(error) return refuse(response, error);
  response.json(result);
};
