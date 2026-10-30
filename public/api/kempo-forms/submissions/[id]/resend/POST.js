import { resendNotification } from '../../../../../../server/utils/submissions/manage.js';
import { gate, refuse } from '../../../../../../server/http/gate.js';

export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:manage');
  if(gateError) return refuse(response, gateError);

  const [error, result] = await resendNotification({ id: request.params.id });
  if(error) return refuse(response, error);
  response.json(result);
};
