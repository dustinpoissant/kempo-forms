import { setSubmissionStatus } from '../../../../../server/utils/submissions/manage.js';
import { body, gate, ids, refuse } from '../../../../../server/http/gate.js';

/* Sets the status (new, read or spam) of one or more submissions. Moving spam out of spam sends the notifications it never got. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:manage');
  if(gateError) return refuse(response, gateError);

  const { ids: list, status, reason } = body(request);
  let changed = 0;
  for(const id of ids(list)){
    const [error] = await setSubmissionStatus({ id, status, reason: typeof reason === 'string' ? reason : '' });
    if(error && error.code !== 409) return refuse(response, error);
    if(!error) changed++;
  }
  response.json({ changed });
};
