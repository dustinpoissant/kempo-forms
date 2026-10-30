import { and, eq } from 'drizzle-orm';
import { db, schema } from 'kempo/server/sdk.js';

/*
  Whether anything can send email: an enabled extension has a handler on the `email:send` hook (kempo-resend, kempo-smtp...).
  kempo itself sends nothing. The settings screen uses this to decide whether Email notifications can be turned on.
*/
export default async () => {
  const handlers = await db.select({ owner: schema.hook.owner }).from(schema.hook).where(eq(schema.hook.event, 'email:send'));
  if(!handlers.length) return false;

  for(const { owner } of handlers){
    const [extension] = await db.select({ enabled: schema.extension.enabled }).from(schema.extension).where(and(eq(schema.extension.name, owner))).limit(1);
    if(!extension || extension.enabled) return true;
  }
  return false;
};
