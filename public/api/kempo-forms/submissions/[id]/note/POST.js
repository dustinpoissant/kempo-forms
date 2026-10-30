import { addSubmissionNote } from '../../../../../../server/utils/submissions/manage.js';
import { body, gate, refuse } from '../../../../../../server/http/gate.js';

export default async (request, response) => {
  const [gateError, session] = await gate(request, 'forms:submissions:manage');
  if(gateError) return refuse(response, gateError);

  const [error] = await addSubmissionNote({ id: request.params.id, note: body(request).note, actor: '' });
  if(error) return refuse(response, error);
  response.status(201).json({ ok: true, by: session.user.id });
};
