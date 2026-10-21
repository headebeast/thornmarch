// Team recolouring for the original unit sheets (pure). The base game ships four team sheets that differ only by a
// 5-colour palette swap; this derives the same swap for ANY team index so a 60-player match gets 60 distinct armies.

import { hexToRgb } from './spriteBuilder.js';
import { teamRamp } from './palettes.js';
import { remapPixels } from './themes.js';

// Colours of the Blue (team 0) sheet, lightest to darkest role
const SRC = { deep: '0c2c67', dark: '005bbd', mid: '388ce9', mid2: '3f93e9', light: '8dd9f4' };

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Mapping suitable for remapPixels(): Blue-sheet colours -> this team's ramp. */
export function teamRecolorMapping(team) {
  const [deep, dark, mid, light] = teamRamp(team).map(hexToRgb);
  return [
    [SRC.deep, deep],
    [SRC.dark, dark],
    [SRC.mid, mid],
    [SRC.mid2, mix(mid, light, 0.12)],
    [SRC.light, light]
  ];
}

/** In-place recolour of an RGBA buffer taken from the Blue unit sheet. */
export function recolorBlueSheet(rgba, team) {
  return remapPixels(rgba, teamRecolorMapping(team));
}
