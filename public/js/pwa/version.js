// Version strings look like "2.1.0+29bc1d705f" (release number + build hash). Pure helpers for showing them.

export const parseVersion = v => {
  const [release = '', build = ''] = String(v || '').split('+');
  return { release, build, short: build.slice(0, 6) };
};

/** "v2.1.0 · 29bc1d" — compact, for chips and detail lines. */
export function describeVersion(v) {
  const { release, short } = parseVersion(v);
  if (!release) return 'unknown version';
  return short ? `v${release} · ${short}` : `v${release}`;
}

/** Same build? (both must be known and identical). */
export const sameBuild = (a, b) => !!a && !!b && a === b;
