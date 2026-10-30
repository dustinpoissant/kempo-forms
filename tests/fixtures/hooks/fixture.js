/*
  A hook handler for a test. Every call is recorded on globalThis.kempoFormsCalls, and a test can decide what the handler does
  by setting globalThis.kempoFormsHandlers[eventName] to a function that gets the payload.
*/
export default name => data => {
  (globalThis.kempoFormsCalls ||= []).push({ event: name, data });
  return globalThis.kempoFormsHandlers?.[name]?.(data);
};
