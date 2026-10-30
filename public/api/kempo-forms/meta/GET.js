import { typeList } from '../../../../server/utils/forms/validate.js';
import { OPERATORS } from '../../../../server/utils/fields/conditions.js';
import { readConfig } from '../../../../server/utils/config/settings.js';
import filesAvailable from '../../../../server/utils/files/available.js';
import { gate, refuse } from '../../../../server/http/gate.js';

/*
  What the form editor needs to know: the field types it can offer on this site, the comparisons a condition can use, and what
  this install can and cannot do right now.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:forms:view');
  if(gateError) return refuse(response, gateError);

  const config = await readConfig();
  const files = Boolean(await filesAvailable());
  response.json({
    types: typeList().filter(type => !type.files || files).filter(type => !type.rich || (type.key === 'markdown' ? config.richText !== 'off' : config.richText === 'html')),
    operators: OPERATORS,
    filesAvailable: files,
    richText: config.richText,
    emailNotifications: config.emailNotifications,
    siteUrl: config.siteUrl,
  });
};
