// Colour helpers shared by config, art and UI (pure).

export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export const rgbToHex = ([r, g, b]) => `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
export const hslHex = (h, s, l) => rgbToHex(hslToRgb(h, s, l));

/** Evenly-spread hue for team index t (golden-angle walk keeps neighbours distinguishable up to 60+ teams). */
export const teamHue = t => (t * 137.508 + 215) % 360;

/** [deep, dark, mid, light] ramp for any team index >= 4 (teams 0-3 use the original hand-tuned ramps). */
export function generatedTeamRamp(t) {
  const h = teamHue(t);
  return [hslHex(h, 70, 16), hslHex(h, 85, 30), hslHex(h, 68, 49), hslHex(h, 78, 76)];
}
