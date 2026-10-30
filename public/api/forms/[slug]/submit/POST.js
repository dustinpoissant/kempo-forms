import submitForm from '../../../../../server/utils/submissions/submit.js';
import filesAvailable from '../../../../../server/utils/files/available.js';
import { body, clientIp, optionalSession, refuse } from '../../../../../server/http/gate.js';

/*
  Sends a form. Public. The body is JSON, { values, extras }, or multipart when the form has files: a `values` part and an
  `extras` part holding JSON, and one part per file named by its field's key. The pipeline gets plain data and never sees the
  request (server/utils/submissions/submit.js).

  Whatever happened, the visitor is told the same thing about spam: a flagged submission answers exactly like an accepted one.
*/

const parseJson = text => {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const readMultipart = async request => {
  const sdk = await filesAvailable();
  if(!sdk) return [{ code: 415, msg: 'This site cannot take file uploads.' }, null];
  const boundary = sdk.extractBoundary(request.headers['content-type']);
  if(!boundary) return [{ code: 400, msg: 'Send the form again.' }, null];

  const parts = sdk.parseMultipart(await request.buffer(), boundary);
  const text = name => parts.find(part => part.name === name && !part.filename)?.data.toString('utf8') ?? '{}';
  const files = {};
  for(const part of parts.filter(entry => entry.filename)) (files[part.name] ||= []).push({ name: part.filename, data: part.data, type: part.contentType });
  return [null, { values: parseJson(text('values')), extras: parseJson(text('extras')), files }];
};

export default async (request, response) => {
  let input = { values: {}, extras: {}, files: {} };

  if(String(request.headers['content-type'] || '').toLowerCase().includes('multipart/form-data')){
    const [error, parsed] = await readMultipart(request);
    if(error) return refuse(response, error);
    input = parsed;
  } else {
    const sent = body(request);
    input = {
      values: sent.values && typeof sent.values === 'object' && !Array.isArray(sent.values) ? sent.values : {},
      extras: sent.extras && typeof sent.extras === 'object' && !Array.isArray(sent.extras) ? sent.extras : {},
      files: {},
    };
  }

  const session = await optionalSession(request);
  const [error, result] = await submitForm({
    slug: request.params.slug,
    ...input,
    meta: { ip: await clientIp(request), userAgent: request.headers['user-agent'] ?? null, userId: session?.user.id ?? null },
  });
  if(error) return refuse(response, error);

  response.status(201).json({ message: result.message, redirectUrl: result.redirectUrl });
};
