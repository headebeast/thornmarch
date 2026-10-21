// Battle Royale map objects — transparent 24x24 overlays composed onto the themed ground like the Frontier buildings.

import { Sprite } from './spriteBuilder.js';
import { MATERIALS, OUTLINE } from './palettes.js';

const mk = () => new Sprite(24, 24, { ...MATERIALS, chute: ['#6a0e1a', '#b01c30', '#e8344a', '#ff8a96'] });

function finish(s, shadow = [12, 20, 8, 2]) {
  s.finish(OUTLINE);
  s.groundShadow(...shadow);
  return s;
}

/** Wooden supply crate with iron straps and a glint. */
export function crate() {
  const s = mk();
  s.rect(5, 10, 14, 10, 'wood');
  s.rect(4, 9, 16, 3, 'woodPale'); // lid
  s.rect(7, 10, 2, 10, 'iron'); // straps
  s.rect(15, 10, 2, 10, 'iron');
  s.rect(11, 13, 2, 3, 'gold'); // latch
  s.px(18, 8, '#ffffff');
  s.px(19, 7, '#fff2a0');
  s.px(17, 7, '#fff2a0');
  return finish(s);
}

/** Gold-trimmed crate hanging from a red parachute — the rare airdrop. */
export function airdrop() {
  const s = mk();
  s.poly([[3, 7], [6, 2], [12, 0], [18, 2], [21, 7]], 'chute');
  s.line(5, 7, 10, 14, '#2a2f3d');
  s.line(12, 6, 12, 14, '#2a2f3d');
  s.line(19, 7, 14, 14, '#2a2f3d');
  s.rect(7, 14, 10, 8, 'gold');
  s.rect(7, 17, 10, 1, 'iron');
  s.rect(11, 15, 2, 6, 'iron');
  s.px(8, 15, '#ffffff');
  s.px(9, 14, '#fff7c0');
  return finish(s, [12, 22, 6, 1]);
}

/** Split-open crate, already looted. */
export function crateEmpty() {
  const s = mk();
  s.rect(5, 13, 14, 7, 'woodPale');
  s.rect(6, 14, 12, 4, 'black');
  s.poly([[4, 11], [9, 8], [10, 12]], 'wood'); // lid hanging off
  s.rect(14, 18, 5, 2, 'wood');
  return finish(s);
}

/**
 * War Camp — a palisade, two tents and a banner pole around a cooking fire. Drawn neutral on purpose: the owner's colour is
 * painted over the top by the renderer, so the same tile serves all 60 warbands.
 */
export function camp() {
  const s = mk();
  // low palisade behind everything, stakes showing between the tents
  s.rect(1, 13, 22, 3, 'wood');
  for (let x = 1; x < 23; x += 3) {
    s.rect(x, 10, 2, 4, 'woodPale');
    s.px(x, 9, 'woodPale');
  }
  // tall canvas tent, lit side / shaded side
  s.poly([[1, 22], [9, 6], [17, 22]], 'cloth');
  s.poly([[9, 6], [17, 22], [10, 22]], 'white');
  s.poly([[8, 22], [9, 15], [11, 22]], 'black'); // doorway
  s.line(9, 6, 9, 3, 'wood'); // pole
  // smaller red tent, in front on the right
  s.poly([[14, 22], [19, 12], [23, 22]], 'roofRed');
  s.poly([[19, 12], [23, 22], [20, 22]], 'brick');
  s.poly([[18, 22], [19, 18], [20, 22]], 'black');
  // cooking fire with a spit, front and centre
  s.rect(11, 21, 4, 1, 'iron');
  s.px(12, 20, 'glowOrange');
  s.px(13, 20, 'glowOrange');
  s.px(12, 19, 'gold');
  s.px(13, 18, '#fff2a0');
  // plain pennant — the owner's banner is painted over the top by the renderer
  s.rect(10, 3, 3, 2, 'white');
  return finish(s, [12, 22, 10, 2]);
}

export const ROYALE_BUILDING_ART = { crate, airdrop, crate_empty: crateEmpty, camp };
