import RE2 from 're2';

/*
  Every regular expression this extension runs on a visitor's input goes through RE2, Google's linear-time engine. A pattern
  that would make a backtracking engine hang on a crafted value cannot do that here, so a site owner's rule (or a field's
  pattern) can never be turned into a way to freeze the server.

  The trade-off is that RE2 has no backreferences and no lookaround. A pattern that uses either is refused when it is saved,
  with the reason, rather than failing later on a visitor's submission.
*/

export const MAX_PATTERN = 500;

const build = (source, flags) => {
  try {
    return [null, new RE2(source, flags)];
  } catch(error) {
    return [{ code: 400, msg: `That pattern cannot be used (backreferences and lookaround are not supported): ${String(error.message).replace(/^.*?:\s*/, '')}` }, null];
  }
};

const check = (pattern, flags) => {
  if(typeof pattern !== 'string' || !pattern) return { code: 400, msg: 'The pattern is empty' };
  if(pattern.length > MAX_PATTERN) return { code: 400, msg: `A pattern can be at most ${MAX_PATTERN} characters` };
  if(typeof flags !== 'string' || /[^im]/.test(flags)) return { code: 400, msg: 'The only flags allowed are i (ignore case) and m (multiple lines)' };
  return null;
};

export const compileRegex = (pattern, flags = '') => {
  const error = check(pattern, flags);
  return error ? [error, null] : build(pattern, flags);
};

/*
  A field's own pattern must match the whole value, as the HTML `pattern` attribute does.
*/
export const compileFullMatch = pattern => {
  const error = check(pattern, '');
  return error ? [error, null] : build(`^(?:${pattern})$`, '');
};
