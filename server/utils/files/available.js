import { getExtension } from 'kempo/server/sdk.js';

/*
  kempo-files is optional. This is its SDK when it is installed and enabled, and null when it is not, so everything that
  depends on it can ask once and carry on without it. It is never imported statically.
*/
export default async () => {
  const [error, extension] = await getExtension({ name: 'kempo-files' });
  if(error || !extension?.enabled) return null;
  try {
    return await import('kempo-files/sdk');
  } catch {
    return null;
  }
};
