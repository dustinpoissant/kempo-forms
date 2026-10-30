import { trashSubmissions } from '../../../../../server/utils/submissions/manage.js';
import { body, gate, ids, refuse } from '../../../../../server/http/gate.js';

export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:manage');
  if(gateError) return refuse(response, gateError);

  const [error, result] = await trashSubmissions({ ids: ids(body(request).ids) });
  if(error) return refuse(response, error);
  response.json(result);
};
