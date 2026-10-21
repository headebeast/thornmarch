// Frontier building overlays — 24x24 sprites with transparent backgrounds. The asset loader composites them
// onto the themed ground tile, so one drawing serves every terrain theme. `owner` is a team index or -1 (neutral).

import { Sprite } from './spriteBuilder.js';
import { withTeam, OUTLINE } from './palettes.js';

const INK = '#141a26';
const mk = owner => new Sprite(24, 24, withTeam(owner));

function flag(s, x, y, w = 4) {
  s.line(x, y, x, y + 6, 'wood');
  s.rect(x + 1, y, w, 3, 'team');
  s.px(x + w, y + 1, null);
}

function finish(s, shadow = [12, 21, 9, 2]) {
  s.finish(OUTLINE);
  s.groundShadow(...shadow);
  return s;
}

export function outpost(owner) {
  const s = mk(owner);
  // timber palisade with a gatehouse
  s.rect(3, 12, 18, 9, 'wood');
  for (let x = 4; x < 21; x += 3) s.rect(x, 10, 2, 3, 'wood'); // crenellations
  for (let x = 5; x < 21; x += 3) s.rect(x, 13, 1, 8, 'woodPale');
  s.rect(9, 14, 6, 7, 'black');
  s.poly([[8, 14], [12, 10], [16, 14]], 'team');
  s.rect(10, 13, 4, 1, 'iron');
  s.px(12, 16, 'woodPale');
  flag(s, 12, 2);
  return finish(s);
}

export function farm(owner, stage) {
  const s = mk(owner);
  s.rect(2, 9, 20, 12, 'soil');
  s.erase(2, 9);
  s.erase(21, 9);
  s.erase(2, 20);
  s.erase(21, 20);
  // furrows
  for (let r = 0; r < 4; r++) s.rect(3, 11 + r * 3, 18, 1, 'soilWet');
  if (stage === 1) {
    for (let r = 0; r < 4; r++) {
      for (let x = 4; x < 21; x += 3) {
        s.px(x, 10 + r * 3, 'sprout');
        s.px(x, 9 + r * 3, 'sprout');
      }
    }
  } else if (stage >= 2) {
    for (let r = 0; r < 4; r++) {
      for (let x = 4; x < 21; x += 3) {
        s.rect(x, 8 + r * 3, 1, 3, 'wheat');
        s.px(x - 1, 8 + r * 3, 'wheat');
        s.px(x + 1, 9 + r * 3, 'wheat');
      }
    }
  } else {
    for (let r = 0; r < 4; r++) for (let x = 5; x < 21; x += 4) s.px(x, 10 + r * 3, 'straw');
  }
  // fence posts + owner flag
  s.rect(1, 20, 1, 2, 'wood');
  s.rect(22, 20, 1, 2, 'wood');
  flag(s, 3, 1, 4);
  s.finish(OUTLINE);
  return s;
}

export function mine(owner) {
  const s = mk(owner);
  s.poly([[2, 21], [5, 11], [10, 6], [16, 7], [21, 12], [22, 21]], 'stone');
  s.poly([[6, 12], [10, 8], [14, 9], [11, 13]], 'stoneWarm');
  s.rect(8, 14, 8, 7, 'black');
  s.rect(7, 13, 10, 1, 'wood'); // lintel
  s.rect(7, 13, 1, 8, 'wood');
  s.rect(16, 13, 1, 8, 'wood');
  s.px(10, 19, 'gold');
  s.px(13, 18, 'gold');
  s.px(12, 20, 'gold');
  // ore cart
  s.rect(17, 18, 5, 3, 'wood');
  s.ellipse(19.5, 17, 2.2, 1.2, 'gold');
  s.px(18, 21, 'iron');
  s.px(21, 21, 'iron');
  flag(s, 4, 3);
  return finish(s);
}

export function watchtower(owner) {
  const s = mk(owner);
  s.rect(8, 8, 8, 14, 'stone');
  for (let y = 10; y < 22; y += 3) s.rect(8, y, 8, 1, 'steel');
  for (let y = 11; y < 22; y += 3) {
    s.px(10, y, 'steel');
    s.px(13, y, 'steel');
  }
  s.rect(6, 5, 12, 3, 'wood'); // platform
  for (let x = 6; x < 18; x += 3) s.rect(x, 3, 2, 2, 'wood');
  s.rect(10, 11, 2, 3, 'black'); // arrow slit
  s.rect(10, 18, 4, 4, 'black'); // door
  flag(s, 12, 0, 4);
  return finish(s, [12, 21, 8, 2]);
}

export function shrine(owner) {
  const s = mk(owner);
  s.ellipse(12, 19, 9.5, 3, 'stone');
  s.ellipse(12, 18, 7.5, 2, 'stoneWarm');
  s.rect(9, 11, 6, 8, 'stoneWarm'); // altar
  s.rect(8, 10, 8, 2, 'stone');
  // healing flame / heart
  s.stamp(
    ['.GG.GG.', 'GGGGGGG', 'GGGGGGG', '.GGGGG.', '..GGG..', '...G...'],
    8,
    3,
    { G: 'glowGreen' }
  );
  s.px(11, 5, '#ffffff');
  s.rect(4, 12, 2, 7, 'stone');
  s.rect(18, 12, 2, 7, 'stone');
  s.px(4, 11, 'glowGreen');
  s.px(5, 11, 'glowGreen');
  s.px(18, 11, 'glowGreen');
  s.px(19, 11, 'glowGreen');
  s.rect(10, 14, 4, 1, 'team'); // owner band on the altar
  return finish(s);
}

export function forge(owner) {
  const s = mk(owner);
  s.rect(3, 11, 18, 10, 'stoneWarm');
  s.poly([[2, 11], [12, 5], [22, 11]], 'iron');
  s.rect(15, 2, 4, 8, 'brick'); // chimney
  s.px(16, 1, '#8a92a4');
  s.px(17, 0, '#b8c0d0');
  s.rect(7, 14, 7, 7, 'black'); // furnace mouth
  s.rect(8, 17, 5, 4, 'glowOrange');
  s.rect(9, 18, 3, 2, 'gold');
  s.rect(16, 17, 4, 2, 'iron'); // anvil
  s.rect(17, 19, 2, 2, 'iron');
  s.rect(3, 11, 18, 1, 'team'); // eave band in owner colour
  return finish(s);
}

export function library(owner) {
  const s = mk(owner);
  s.rect(4, 11, 16, 10, 'woodPale');
  for (let x = 5; x < 20; x += 3) s.rect(x, 12, 1, 9, 'wood');
  s.poly([[3, 11], [12, 4], [21, 11]], 'team');
  s.ellipse(12, 15, 2.6, 2.6, 'gold');
  s.ellipse(12, 15, 1.4, 1.4, 'black');
  s.px(12, 15, '#fff2a0');
  s.rect(10, 18, 4, 3, 'black'); // door
  s.rect(5, 15, 2, 3, 'glowTeal'); // windows
  s.rect(17, 15, 2, 3, 'glowTeal');
  s.px(12, 2, 'gold');
  s.px(12, 3, 'gold');
  return finish(s);
}

export function obelisk(owner) {
  const s = mk(owner);
  s.rect(5, 19, 14, 3, 'stone'); // stepped base
  s.rect(7, 17, 10, 2, 'stoneWarm');
  s.poly([[9, 17], [10, 3], [14, 3], [15, 17]], 'black');
  s.poly([[10, 3], [12, 0], [14, 3]], 'gold');
  for (let y = 6; y < 16; y += 3) {
    s.px(11, y, 'gold');
    s.px(12, y + 1, 'gold');
    s.px(13, y, 'gold');
  }
  s.rect(9, 15, 6, 1, 'team'); // owner band
  s.px(8, 18, 'glowTeal');
  s.px(15, 18, 'glowTeal');
  return finish(s);
}

export function ruins(owner, stage = 0) {
  const s = mk(-1);
  s.rect(4, 13, 4, 8, 'stoneWarm');
  s.rect(4, 11, 3, 2, 'stoneWarm');
  s.rect(15, 8, 4, 13, 'stoneWarm');
  s.rect(14, 8, 2, 2, 'stone');
  s.ellipse(11, 20, 3.4, 1.5, 'stone'); // fallen column
  s.rect(9, 19, 5, 2, 'stoneWarm');
  s.px(5, 15, 'moss');
  s.px(16, 12, 'moss');
  s.px(17, 17, 'moss');
  s.px(10, 20, 'moss');
  if (stage === 0) {
    // glint of treasure
    s.px(11, 17, 'gold');
    s.px(12, 17, 'gold');
    s.px(11, 16, 'gold');
    s.px(8, 15, '#ffffff');
    s.px(12, 13, '#ffffff');
  } else {
    s.px(10, 18, 'stone');
    s.px(13, 18, 'stone');
  }
  return finish(s);
}

/** Registry used by the Frontier content pack: art key -> sprite factory (owner, stage). */
export const BUILDING_ART = {
  outpost,
  farm,
  mine,
  watchtower,
  shrine,
  forge,
  library,
  obelisk,
  ruins
};
