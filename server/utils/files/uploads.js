import filesAvailable from './available.js';

/*
  Files sent with a submission, kept in kempo-files (optional: see available.js).

  Each is stored with `reviewable: false`. In kempo-files that is a one-way gate: the file can never be approved to run, and it is
  served inert whatever its name (source as plain text, PDFs and Office files as downloads, images as images, all with nosniff).
  The kempo-files README names a form attachment as the case it is for. Nothing is public: only staff with `files:download`
  can open an upload, from the submission's page.

  Anonymous visitors have no user id, and kempo-files refuses an upload with no owner, so an anonymous upload is owned by the
  text `kempo-forms`. The owner column has no foreign key, so that is allowed.
*/

const OWNER = 'kempo-forms';
const ROOT = 'form-uploads';
const IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'];

export const extensionOf = name => {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(name ?? ''));
  return match ? match[1].toLowerCase() : '';
};

/*
  A name the visitor chose, made safe to be a path segment: no separators, no control characters, no leading dots, at most 100
  characters with the extension kept.
*/
export const safeName = name => {
  const cleaned = String(name ?? 'file').normalize('NFKD').replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').replace(/^[.\s_-]+/, '').trim();
  const extension = extensionOf(cleaned);
  const stem = extension ? cleaned.slice(0, -(extension.length + 1)) : cleaned;
  return `${(stem || 'file').slice(0, 100 - (extension ? extension.length + 1 : 0))}${extension ? `.${extension}` : ''}`;
};

export const maxFilesFor = (field, config) => {
  const own = Number.isInteger(field.settings?.maxFiles) && field.settings.maxFiles > 0 ? field.settings.maxFiles : (field.type === 'image' ? 1 : config.uploadMaxFiles);
  return Math.min(own, config.uploadMaxFiles);
};

/*
  The reason this field's files cannot be accepted, or null. `list` is [{ name, size }]. The extension list is a convenience for
  the visitor (the wrong kind of file is caught early); the safety is in how kempo-files serves what is stored.
*/
export const checkFiles = (field, list, config) => {
  const most = maxFilesFor(field, config);
  if(list.length > most) return `Send at most ${most} file${most === 1 ? '' : 's'}.`;
  const accept = field.settings?.accept?.length ? field.settings.accept : (field.type === 'image' ? IMAGES : null);
  for(const file of list){
    if(!file.size) return `"${file.name}" is empty.`;
    if(file.size > config.uploadMaxBytes) return `"${file.name}" is larger than ${Math.round(config.uploadMaxBytes / 1048576 * 10) / 10} MB.`;
    if(accept && !accept.includes(extensionOf(file.name))) return `"${file.name}" is not an accepted kind of file (${accept.join(', ')}).`;
  }
  return null;
};

const folderIn = async (sdk, name, parentId) => {
  const [, found] = await sdk.listDirectories({ parentId });
  const existing = found?.directories?.find(directory => directory.name === name);
  if(existing) return [null, existing.id];
  const [error, created] = await sdk.createDirectory({ name, parentId, ownerId: OWNER });
  if(!error) return [null, created.id];
  const [, again] = await sdk.listDirectories({ parentId });
  const raced = again?.directories?.find(directory => directory.name === name);
  return raced ? [null, raced.id] : [error, null];
};

export const removeFiles = async ids => {
  const sdk = await filesAvailable();
  if(!sdk) return;
  for(const id of ids) await sdk.deleteFile({ id });
};

/*
  Stores the files of every file field and returns { keys: { [key]: [file ids] }, stored: [every id] }, so the caller can take them
  back if the submission cannot be saved after all. `files` is { [key]: [{ name, data, type }] }.
*/
export const storeFiles = async ({ submissionId, formSlug, fields, files, userId, config }) => {
  const sdk = await filesAvailable();
  const stored = [];
  const keys = {};
  if(!sdk) return [null, { keys, stored }];

  const [rootError, rootId] = await folderIn(sdk, ROOT, null);
  if(rootError) return [{ code: 500, msg: 'The files could not be stored.' }, null];
  const [formError, directoryId] = await folderIn(sdk, formSlug, rootId);
  if(formError) return [{ code: 500, msg: 'The files could not be stored.' }, null];

  for(const field of fields){
    for(const file of files[field.key] || []){
      const [error, row] = await sdk.storeUpload({
        name: `${submissionId}-${safeName(file.name)}`,
        data: file.data,
        directoryId,
        ownerId: userId || OWNER,
        reviewable: false,
        public: false,
        maxBytes: config.uploadMaxBytes,
      });
      if(error){
        await removeFiles(stored);
        return [{ code: error.code === 413 ? 413 : 500, msg: error.code === 413 ? error.msg : 'The files could not be stored.' }, null];
      }
      stored.push(row.id);
      (keys[field.key] ||= []).push(row.id);
    }
  }
  return [null, { keys, stored }];
};

/*
  Every file id held in a submission's values, given its schema snapshot.
*/
export const fileIdsOf = (schema, values) => schema
  .filter(field => field.type === 'file' || field.type === 'image')
  .flatMap(field => Array.isArray(values?.[field.key]) ? values[field.key].map(String) : []);
