// POST /api/forget {vid} — a visitor erases everything recorded under their browser's random id.
import { analytics, respond } from '../lib/common.mjs';

export const config = { path: '/api/forget', method: ['POST'] };

export default async req => {
  const body = await req.text();
  if (body.length > 2048) return respond({ status: 413 });
  return respond(await analytics().forget({ body }));
};
