/*
  Email addresses: a deliberately simple shape check (something@something.tld), because the only real test of an address is
  sending to it. A list is split on commas, semicolons and line breaks, lowercased, and freed of duplicates.
*/
const SHAPE = /^[^\s@<>()[\]\,;:"]+@[^\s@<>()[\]\,;:"]+\.[^\s@<>()[\]\,;:"]{2,}$/;

export const isEmail = value => typeof value === 'string' && value.length <= 254 && SHAPE.test(value.trim());

export const splitEmails = value => {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
  return [...new Set(parts.map(part => String(part).trim().toLowerCase()).filter(Boolean))];
};
