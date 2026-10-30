import { triggerHook } from 'kempo/server/sdk.js';

/*
  Every hook this extension fires is named `kempo-forms:<resource>:<event>`. Two kinds, as in kempo-commerce:

  **A guard** runs before something happens. Handlers get the payload by reference and may change it (push a verdict, edit a
  draft), and refuse by throwing { code, msg }, which reaches the caller exactly. A handler that fails some other way refuses
  too, with a generic message: a guard that fails open would let through whatever it was installed to stop.

  **A note** runs after the change is committed. A handler that throws is logged by kempo and stops nothing, and nothing a
  handler does can undo the change.
*/

export const PREFIX = 'kempo-forms:';

export const guard = async (event, payload) => {
  try {
    await triggerHook(`${PREFIX}${event}`, payload, { bail: true });
    return [null, payload];
  } catch(error) {
    if(error && typeof error === 'object' && Number.isInteger(error.code) && typeof error.msg === 'string'){
      return [{ code: error.code, msg: error.msg }, null];
    }
    console.error(`[kempo-forms] A handler for ${PREFIX}${event} failed: ${error?.message ?? error}`);
    return [{ code: 500, msg: 'This could not be completed right now.' }, null];
  }
};

export const notify = async (event, payload) => {
  try {
    await triggerHook(`${PREFIX}${event}`, payload);
  } catch(error) {
    console.error(`[kempo-forms] Could not fire ${PREFIX}${event}: ${error?.message ?? error}`);
  }
};
