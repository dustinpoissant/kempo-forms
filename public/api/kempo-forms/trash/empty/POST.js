import { emptyFormTrash } from '../../../../../server/utils/forms/trash.js';
import { emptySubmissionTrash } from '../../../../../server/utils/submissions/manage.js';
import { body, gate, ids, refuse } from '../../../../../server/http/gate.js';

/*
  Removes for good. `{ forms: true }` empties the archived forms (and their submissions), `{ submissions: true }` the trashed
  submissions. Each needs its own permission.
*/
export default async (request, response) => {
  const sent = body(request);
  const result = { forms: 0, submissions: 0 };

  if(sent.forms){
    const [gateError] = await gate(request, 'forms:forms:manage');
    if(gateError) return refuse(response, gateError);
    const [error, emptied] = await emptyFormTrash({ ids: sent.ids ? ids(sent.ids) : null });
    if(error) return refuse(response, error);
    result.forms = emptied.forms;
    result.submissions += emptied.submissions;
  }

  if(sent.submissions){
    const [gateError] = await gate(request, 'forms:submissions:manage');
    if(gateError) return refuse(response, gateError);
    const [error, emptied] = await emptySubmissionTrash({});
    if(error) return refuse(response, error);
    result.submissions += emptied.purged;
  }

  response.json(result);
};
