// Is this web app manifest good enough that browsers will offer to install the game — and will the icons look right?
// Returns a list of problems (empty = fine). Used by `npm run check` (on public/ and on the built dist/) and by the tests.
//
// It checks what installability requires (name, start_url inside scope, a standalone-type display mode, 192 and 512 icons)
// and what quality requires (every icon file exists and is REALLY the size it claims; the maskable icon is fully opaque and its
// artwork stays inside the central 80 % "safe zone" that Android never crops; shortcuts and screenshots point at real files).

import fs from 'fs';
import path from 'path';
import { decodePng } from './png.mjs';

const DISPLAY = ['fullscreen', 'standalone', 'minimal-ui'];
const HEX = /^#[0-9a-f]{3,8}$/i;
const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/** @param {object} manifest @param {string} root the folder the manifest's absolute paths ('/assets/…') are relative to */
export function checkManifest(manifest, root) {
  const problems = [];
  const bad = msg => problems.push(msg);
  const file = src => path.join(root, src.replace(/^\//, '').split(/[?#]/)[0]);
  const need = (cond, msg) => cond || bad(msg);

  need(typeof manifest.name === 'string' && manifest.name.length > 0, 'name is missing');
  need(typeof manifest.short_name === 'string' && manifest.short_name.length > 0 && manifest.short_name.length <= 14, 'short_name is missing or too long to fit under a home-screen icon (max 14)');
  need(manifest.id, 'id is missing (it keeps the app\'s identity stable if start_url ever changes)');
  need(manifest.start_url && manifest.scope && new URL(manifest.start_url, 'https://x.test').pathname.startsWith(manifest.scope), 'start_url must lie inside scope');
  need(DISPLAY.includes(manifest.display) || (manifest.display_override || []).some(d => DISPLAY.includes(d)), `display must be one of ${DISPLAY.join(', ')} (anything else is just a browser tab)`);
  need(HEX.test(manifest.background_color || '') && HEX.test(manifest.theme_color || ''), 'background_color and theme_color must be hex colours (they paint the launch splash screen)');
  need(typeof manifest.description === 'string' && manifest.description.length > 10, 'description is missing');

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  need(icons.length > 0, 'no icons');
  const has = (purpose, size) => icons.some(i => (i.purpose || 'any').split(' ').includes(purpose) && String(i.sizes).split(' ').includes(`${size}x${size}`) && i.type === 'image/png');
  for (const size of [192, 512]) need(has('any', size), `an "any" PNG icon of ${size}x${size} is required for installability`);
  for (const size of [192, 512]) need(has('maskable', size), `a "maskable" PNG icon of ${size}x${size} is needed so Android does not shrink the icon into a white circle`);

  for (const icon of icons) {
    const f = file(icon.src);
    if (!fs.existsSync(f)) {
      bad(`icon ${icon.src} does not exist`);
      continue;
    }
    if (icon.type !== 'image/png') continue;
    let png;
    try {
      png = decodePng(fs.readFileSync(f));
    } catch (e) {
      bad(`icon ${icon.src} is not a readable PNG`);
      continue;
    }
    const declared = String(icon.sizes);
    need(declared === `${png.width}x${png.height}`, `icon ${icon.src} says ${declared} but is really ${png.width}x${png.height}`);
    if ((icon.purpose || 'any').split(' ').includes('maskable')) {
      let opaque = true;
      let minX = png.width;
      let maxX = 0;
      let minY = png.height;
      let maxY = 0;
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const i = (y * png.width + x) * 4;
          if (png.data[i + 3] < 255) opaque = false;
          if (luma(png.data, i) > 70) {
            // bright artwork (the plate is dark navy)
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      need(opaque, `maskable icon ${icon.src} has transparent pixels (it would show a black or white background)`);
      const m = 0.1; // the safe zone: the central 80 %
      need(minX >= png.width * m && maxX <= png.width * (1 - m) && minY >= png.height * m && maxY <= png.height * (1 - m), `maskable icon ${icon.src}: artwork reaches outside the central 80 % and would be cropped by round masks`);
    }
  }

  for (const s of manifest.shortcuts || []) {
    need(s.name && s.url, `a shortcut lacks a name or url (${JSON.stringify(s).slice(0, 60)})`);
    need(new URL(s.url, 'https://x.test').pathname.startsWith(manifest.scope || '/'), `shortcut "${s.name}" leaves the app's scope`);
    for (const i of s.icons || []) need(fs.existsSync(file(i.src)), `shortcut "${s.name}": icon ${i.src} does not exist`);
  }

  for (const sc of manifest.screenshots || []) {
    const f = file(sc.src);
    if (!fs.existsSync(f)) {
      bad(`screenshot ${sc.src} does not exist`);
      continue;
    }
    const png = decodePng(fs.readFileSync(f));
    need(String(sc.sizes) === `${png.width}x${png.height}`, `screenshot ${sc.src} says ${sc.sizes} but is really ${png.width}x${png.height}`);
    need(['wide', 'narrow'].includes(sc.form_factor), `screenshot ${sc.src} needs form_factor "wide" or "narrow"`);
    need(Math.max(png.width, png.height) <= 2.3 * Math.min(png.width, png.height), `screenshot ${sc.src}: sides may differ by at most 2.3x`);
  }
  return problems;
}
