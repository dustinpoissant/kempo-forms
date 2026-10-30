import { getForm } from '../../../../../server/utils/forms/read.js';
import { gate, refuse } from '../../../../../server/http/gate.js';

export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:forms:view');
  if(gateError) return refuse(response, gateError);

  const [error, form] = await getForm({ id: request.params.id });
  if(error) return refuse(response, error);
  response.json({ form });
};
