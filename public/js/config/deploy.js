// Per-deployment settings. They live in <meta> tags of index.html (the build script writes them), so a single build can be
// hosted anywhere without touching code:
//
//   <meta name="aeii-server" content="wss://play.example.com">   where the multiplayer server is ("" = the page's own host)
//   <meta name="aeii-online" content="off">                        hide online play (e.g. on a purely static host)
//   <meta name="aeii-source" content="https://github.com/you/repo"> where the game's source code can be found (GPL)
//   <meta name="aeii-version" content="2.1.0">                     shown in the menu
//   <meta name="aeii-analytics" content="/api">                    base address of the usage-statistics API ("" = no analytics, no banner)
//
// `window.AEII_SERVER` (set from a script) overrides the server tag, which is handy for local testing.

const meta = name => (typeof document === 'undefined' ? '' : document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || '');

/** `wss://host/path` the multiplayer client should open, from the setting or the current page. */
function socketUrl() {
  let base = (typeof window !== 'undefined' && window.AEII_SERVER) || meta('aeii-server');
  if (base) {
    base = base.replace(/^http/, 'ws').replace(/\/+$/, '');
    return /\/ws$/.test(base) ? base : `${base}/ws`;
  }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

export const deploy = {
  get socketUrl() {
    return socketUrl();
  },
  get online() {
    return meta('aeii-online') !== 'off';
  },
  get sourceUrl() {
    return meta('aeii-source');
  },
  get analyticsUrl() {
    return meta('aeii-analytics');
  },
  get version() {
    return meta('aeii-version') || 'dev';
  }
};
