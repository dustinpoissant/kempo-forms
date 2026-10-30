import { testRules } from '../../../../../server/utils/spam/rules.js';
import { body, gateAny, refuse } from '../../../../../server/http/gate.js';

/* The rule tester: which of these rules match this sample. Nothing is saved. */
export default async (request, response) => {
  const [gateError] = await gateAny(request, ['forms:forms:manage', 'forms:settings:manage']);
  if(gateError) return refuse(response, gateError);

  const { rules, sample } = body(request);
  const [error, result] = testRules({ rules, sample });
  if(error) return refuse(response, error);
  response.json(result);
};
