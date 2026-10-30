import { duplicateForm } from '../../../../../../server/utils/forms/save.js';
import { gate, refuse } from '../../../../../../server/http/gate.js';

export default async (request, response) => {
  const [gateError, session] = await gate(request, 'forms:forms:manage');
  if(gateError) return refuse(response, gateError);

  const [error, form] = await duplicateForm({ id: request.params.id, createdBy: session.user.id });
  if(error) return refuse(response, error);
  response.status(201).json({ form });
};
