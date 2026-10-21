// Minimal dependency-free PNG codec (Node). Decodes 1/2/4/8-bit palette, 8-bit gray/RGB/RGBA;
// encodes 8-bit RGBA. Used by build scripts and art previews — never shipped to the client.

import zlib from 'zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('Not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 8;
  let colorType = 6;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  if (interlace) throw new Error('Interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const b = y > 0 ? out[dst - stride + i] : 0;
      const c = i >= bpp && y > 0 ? out[dst - stride + i - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        default: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
      }
      out[dst + i] = v & 255;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  const sample = (row, idx) => {
    if (depth === 8) return out[row * stride + idx];
    const bitPos = idx * depth;
    const byte = out[row * stride + (bitPos >> 3)];
    return (byte >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 3) {
        const i = sample(y, x);
        rgba[o] = palette[i * 3];
        rgba[o + 1] = palette[i * 3 + 1];
        rgba[o + 2] = palette[i * 3 + 2];
        rgba[o + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (colorType === 6) {
        for (let k = 0; k < 4; k++) rgba[o + k] = out[y * stride + x * 4 + k];
      } else if (colorType === 2) {
        for (let k = 0; k < 3; k++) rgba[o + k] = out[y * stride + x * 3 + k];
        rgba[o + 3] = 255;
      } else if (colorType === 0) {
        const g = out[y * stride + x];
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = 255;
      } else {
        const g = out[y * stride + x * 2];
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = out[y * stride + x * 2 + 1];
      }
    }
  }
  return { width, height, data: rgba };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode RGBA pixels, optionally upscaling by an integer factor (nearest-neighbour) for previews. */
export function encodePng(width, height, rgba, scale = 1) {
  const W = width * scale;
  const H = height * scale;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    const sy = (y / scale) | 0;
    for (let x = 0; x < W; x++) {
      const sx = (x / scale) | 0;
      const s = (sy * width + sx) * 4;
      const o = y * (W * 4 + 1) + 1 + x * 4;
      raw[o] = rgba[s];
      raw[o + 1] = rgba[s + 1];
      raw[o + 2] = rgba[s + 2];
      raw[o + 3] = rgba[s + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
