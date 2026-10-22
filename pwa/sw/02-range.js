// ---- byte ranges ---------------------------------------------------------------------------------------------------------
// Browsers stream music with "Range: bytes=…" requests, which a cache cannot answer by itself. Given a COMPLETE stored
// response, these build the partial one the browser asked for.

/** 'bytes=0-99' · 'bytes=100-' · 'bytes=-500' → { start, end } (inclusive) · null = not a single range (serve everything) · 'unsatisfiable'. */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    const n = Number(m[2]); // the last n bytes
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

async function rangeResponse(full, header) {
  const buf = await full.arrayBuffer();
  const range = parseRange(header, buf.byteLength);
  const type = full.headers.get('Content-Type') || 'application/octet-stream';
  if (range === null) return new Response(buf, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(buf.byteLength), 'Accept-Ranges': 'bytes' } });
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${buf.byteLength}` } });
  return new Response(buf.slice(range.start, range.end + 1), {
    status: 206,
    headers: { 'Content-Type': type, 'Content-Range': `bytes ${range.start}-${range.end}/${buf.byteLength}`, 'Content-Length': String(range.end - range.start + 1), 'Accept-Ranges': 'bytes' }
  });
}
