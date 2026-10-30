/*
  Spam verdicts. A verdict is { source, action, reason, message?, score? }:

    accept   recorded and changes nothing (an extension can show "this scored 0.2" without affecting the outcome)
    spam     the submission is saved with status `spam` and is not emailed
    reject   the submission is refused and nothing is saved; `message` is shown to the visitor

  Every handler of `kempo-forms:submission:filter` pushes onto the same list and the list is decided once, afterwards, so the
  order extensions run in never changes the outcome.
*/

export const ACTIONS = ['accept', 'spam', 'reject'];

/*
  Makes a verdict from whatever an extension pushed: anything that is not a recognised action counts as `accept`, so a handler
  that gets it wrong cannot refuse or flag by accident, and the text is cut to a sensible length.
*/
export const cleanVerdict = raw => ({
  source: String(raw?.source ?? 'unknown').slice(0, 100),
  action: ACTIONS.includes(raw?.action) ? raw.action : 'accept',
  reason: String(raw?.reason ?? '').slice(0, 500),
  ...(raw?.message ? { message: String(raw.message).slice(0, 300) } : {}),
  ...(Number.isFinite(raw?.score) ? { score: raw.score } : {}),
});

/*
  The outcome of a list of verdicts: 'reject' beats 'spam' beats 'accept'.
*/
export const decide = verdicts => {
  const rejection = verdicts.find(verdict => verdict.action === 'reject');
  if(rejection) return { outcome: 'reject', message: rejection.message || 'Your submission was not accepted.' };
  return { outcome: verdicts.some(verdict => verdict.action === 'spam') ? 'spam' : 'accept', message: '' };
};
