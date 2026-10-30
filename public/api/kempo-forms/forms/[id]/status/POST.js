import { setFormStatus } from '../../../../../../server/utils/forms/save.js';
import { body, gate, refuse } from '../../../../../../server/http/gate.js';

/* live, paused, or archived (the Trash). Restoring from the Trash brings a form back paused. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:forms:manage');
  if(gateError) return refuse(response, gateError);

  const [error, form] = await setFormStatus({ id: request.params.id, status: body(request).status });
  if(error) return refuse(response, error);
  response.json({ form });
};
