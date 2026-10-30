import { findMatches } from '../../../../../server/utils/privacy/erase.js';
import { gate, refuse } from '../../../../../server/http/gate.js';

/* The submissions a request about this email address would cover, so the owner sees what an erasure would touch first. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:view');
  if(gateError) return refuse(response, gateError);

  const email = String(request.query?.email ?? '');
  if(!email.trim()) return refuse(response, { code: 400, msg: 'Enter an email address.' });

  const rows = await findMatches({ email });
  response.json({ total: rows.length, items: rows.map(({ id, formTitle, createdAt, status }) => ({ id, formTitle, createdAt, status })) });
};
