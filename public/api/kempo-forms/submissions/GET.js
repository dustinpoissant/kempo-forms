import { listSubmissions } from '../../../../server/utils/submissions/read.js';
import { gate, refuse } from '../../../../server/http/gate.js';

/* Submissions, newest first. Filters: form, status, search, from, to. Blank status leaves out spam and the Trash. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:view');
  if(gateError) return refuse(response, gateError);

  const { form, status, search, from, to, limit, offset } = request.query || {};
  const [error, result] = await listSubmissions({ formId: form, status, search, from, to, limit, offset });
  if(error) return refuse(response, error);

  /* The list never carries the history or the extension data, only what a row needs. */
  response.json({
    total: result.total,
    items: result.items.map(({ data, spam, ...row }) => ({ ...row, spamSources: spam.map(verdict => verdict.source) })),
  });
};
