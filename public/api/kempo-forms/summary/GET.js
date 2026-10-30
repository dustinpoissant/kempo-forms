import { countByStatus, countSince } from '../../../../server/utils/submissions/read.js';
import { gate, refuse } from '../../../../server/http/gate.js';

/* For the dashboard widget: new submissions today and this week, the unread ones, and the spam waiting for review. */
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:submissions:view');
  if(gateError) return refuse(response, gateError);

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const week = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const counts = await countByStatus();
  response.json({ today: await countSince(today), week: await countSince(week), unread: counts.new, spam: counts.spam });
};
