import { previewEmptyTrash } from '../../../../../server/utils/forms/trash.js';
import { gate, refuse } from '../../../../../server/http/gate.js';

/* What emptying the Trash of forms would remove, for the confirmation. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:forms:manage');
  if(gateError) return refuse(response, gateError);

  const [, preview] = await previewEmptyTrash();
  response.json(preview);
};
