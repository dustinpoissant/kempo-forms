import { updateForm } from '../../../../../server/utils/forms/save.js';
import { body, gate, refuse } from '../../../../../server/http/gate.js';

/* Changes the properties sent; everything else stays. The answer is the whole form as stored. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:forms:manage');
  if(gateError) return refuse(response, gateError);

  const [error, form] = await updateForm({ id: request.params.id, changes: body(request) });
  if(error) return refuse(response, error);
  response.json({ form });
};
