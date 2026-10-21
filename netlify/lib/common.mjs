// Shared glue for the Netlify functions: build the analytics API from the environment, and turn {status, json} into a Response.

import { createAnalytics, LIMITS } from '../../analytics/handlers.mjs';
import { BlobStore } from './blobStore.mjs';

export { LIMITS };
let api;

/** One API object per function instance (it holds the rate-limit memory). */
export function analytics() {
  return (api ??= createAnalytics({ store: new BlobStore(), env: process.env }));
}

export function respond({ status, json }) {
  return new Response(json ? JSON.stringify(json) : null, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
  });
}

/** Netlify tells functions where the request came from. Keep only what the statistics use. */
export function origin(context) {
  const g = context.geo || {};
  return {
    ip: context.ip || '',
    geo: g.country?.code ? { country: g.country.code, countryName: g.country.name, region: g.subdivision?.name || '', city: g.city || '', lat: g.latitude, lon: g.longitude, tz: g.timezone || '' } : null
  };
}
