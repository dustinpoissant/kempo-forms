import { createForm } from '../../../../server/utils/forms/save.js';
import { body, gate, refuse } from '../../../../server/http/gate.js';

export default async (request, response) => {
  const [gateError, session] = await gate(request, 'forms:forms:manage');
  if(gateError) return refuse(response, gateError);

  const [error, form] = await createForm({ input: body(request), createdBy: session.user.id });
  if(error) return refuse(response, error);
  response.status(201).json({ form });
};
