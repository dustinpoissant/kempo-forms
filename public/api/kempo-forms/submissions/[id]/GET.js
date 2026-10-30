import { getSubmissionDetail } from '../../../../../server/utils/submissions/read.js';
import filesAvailable from '../../../../../server/utils/files/available.js';
import { fileIdsOf } from '../../../../../server/utils/files/uploads.js';
import { gate, refuse } from '../../../../../server/http/gate.js';

/*
  One submission with its labelled values, its history and its spam verdicts. A file field lists the files by name, each with the
  address kempo-files serves it from, which only people holding files:download can open.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:view');
  if(gateError) return refuse(response, gateError);

  const [error, submission] = await getSubmissionDetail({ id: request.params.id });
  if(error) return refuse(response, error);

  const files = [];
  const sdk = await filesAvailable();
  if(sdk){
    for(const id of fileIdsOf(submission.schema, submission.values)){
      const [fileError, file] = await sdk.getFile(id);
      if(!fileError) files.push({ id: file.id, name: file.name.replace(/^[0-9a-f-]{36}-/, ''), kind: file.kind, url: `/kempo-files/api/files/${encodeURIComponent(file.id)}` });
    }
  }
  response.json({ submission, files });
};
