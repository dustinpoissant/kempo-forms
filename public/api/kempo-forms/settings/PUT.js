import { setSetting } from 'kempo/server/sdk.js';
import { descriptionOf, typeOf } from '../../../../server/utils/config/declared.js';
import { OWNER, readConfig } from '../../../../server/utils/config/settings.js';
import { validateSettings } from '../../../../server/utils/config/validate.js';
import { body, gate, refuse } from '../../../../server/http/gate.js';

/*
  Saves settings, each as an ordinary kempo setting with its declared type and description — they also appear on kempo's own
  /admin/settings screen, and passing null for a description there would erase it. `forms:settings:manage` is its own
  permission, so whoever runs the forms does not need the right to change every setting on the site.
*/
export default async (request, response) => {
  const [gateError] = await gate(request, 'forms:settings:manage');
  if(gateError) return refuse(response, gateError);

  const [error, updates] = await validateSettings(body(request));
  if(error) return refuse(response, error);

  for(const [name, value] of Object.entries(updates)){
    const [saveError] = await setSetting(OWNER, name, value, typeOf(name), false, descriptionOf(name));
    if(saveError) return refuse(response, saveError);
  }

  response.json({ config: await readConfig() });
};
