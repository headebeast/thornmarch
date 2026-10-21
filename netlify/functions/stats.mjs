// GET /api/stats?days=30 — the dashboard's numbers. Needs "Authorization: Bearer <ANALYTICS_TOKEN>".
import { analytics, respond } from '../lib/common.mjs';

export const config = { path: '/api/stats', method: ['GET'] };

export default async req => {
  const days = new URL(req.url).searchParams.get('days');
  return respond(await analytics().stats({ authorization: req.headers.get('authorization') || '', days }));
};
