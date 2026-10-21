// POST /api/collect — a browser that was given consent reports a batch of usage events.
import { analytics, respond, origin, LIMITS } from '../lib/common.mjs';

export const config = { path: '/api/collect', method: ['POST'] };

export default async (req, context) => {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > LIMITS.body) return respond({ status: 413 });
  const body = await req.text();
  if (body.length > LIMITS.body) return respond({ status: 413 });
  const { ip, geo } = origin(context);
  return respond(await analytics().collect({ body, ip, geo, ua: req.headers.get('user-agent') || '' }));
};
