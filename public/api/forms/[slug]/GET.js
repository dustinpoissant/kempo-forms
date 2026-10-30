import publicForm from '../../../../server/utils/forms/public.js';
import { optionalSession, refuse } from '../../../../server/http/gate.js';

/*
  How to draw a form: its fields and labels, and nothing about where submissions go. Public.
*/
export default async (request, response) => {
  const session = await optionalSession(request);
  const [error, form] = await publicForm({ slug: request.params.slug, userId: session?.user.id ?? null });
  if(error) return refuse(response, error);
  response.json({ form });
};
