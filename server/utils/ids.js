import crypto from 'crypto';

/*
  Ids are random UUIDs: they appear in admin URLs and in emails, so they must not be guessable or countable.
*/
export const newId = () => crypto.randomUUID();
