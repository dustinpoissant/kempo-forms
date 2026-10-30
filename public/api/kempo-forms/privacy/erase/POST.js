import { requestErasure } from '../../../../../server/utils/privacy/erase.js';
import { body, gate, refuse } from '../../../../../server/http/gate.js';

/* Erases the personal fields of every submission about this email address. Needs the manage permission. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:manage');
  if(gateError) return refuse(response, gateError);

  const [error, result] = await requestErasure({ email: body(request).email, source: 'admin' });
  if(error) return refuse(response, error);
  response.json(result);
};
