import { countByStatus } from '../../../../../server/utils/submissions/read.js';
import { gate, refuse } from '../../../../../server/http/gate.js';

export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:view');
  if(gateError) return refuse(response, gateError);

  response.json({ counts: await countByStatus({ formId: request.query?.form }) });
};
