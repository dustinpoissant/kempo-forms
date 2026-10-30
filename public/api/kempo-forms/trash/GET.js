import { listForms } from '../../../../server/utils/forms/read.js';
import { countByStatus } from '../../../../server/utils/submissions/read.js';
import { gateAny, refuse } from '../../../../server/http/gate.js';

/* What is in the Trash: the archived forms, and how many trashed submissions there are. */
export default async (request, response) => {
  const [gateError] = await gateAny(request, ['forms:forms:view', 'forms:submissions:view']);
  if(gateError) return refuse(response, gateError);

  const [, forms] = await listForms({ status: 'archived', limit: 200 });
  const counts = await countByStatus();
  response.json({ forms: forms.items, trashedSubmissions: counts.trashed });
};
