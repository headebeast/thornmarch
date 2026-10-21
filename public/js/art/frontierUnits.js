// Frontier unit sprites — 24x24, two idle frames, any team colour. Painted with the sprite builder.
// Each function returns a finished Sprite for (team, frame).

import { Sprite } from './spriteBuilder.js';
import { withTeam, OUTLINE } from './palettes.js';

const INK = '#141a26';

function base(team, extra) {
  return new Sprite(24, 24, withTeam(team, extra));
}

function face(s, cx, y) {
  s.px(cx - 1, y, INK);
  s.px(cx + 1, y, INK);
}

/** Standard humanoid body: legs, torso, arms. Heads/hats/weapons are added per unit. */
function body(s, f, { torso = 'cloth', legs = 'leather', boots = 'soilWet', sleeve = null, hands = 'skin' } = {}) {
  const dy = f;
  s.rect(9, 17, 3, 3, legs);
  s.rect(13, 17, 3, 3, legs);
  s.rect(9, 20, 3, 2, boots);
  s.rect(13, 20, 3, 2, boots);
  s.rect(8, 10 + dy, 8, 7, torso);
  s.rect(6, 11 + dy, 2, 5, sleeve || torso);
  s.rect(16, 11 + dy, 2, 5, sleeve || torso);
  s.px(6, 16 + dy, hands);
  s.px(7, 16 + dy, hands);
  s.px(16, 16 + dy, hands);
  s.px(17, 16 + dy, hands);
}

function headAt(s, f, mat = 'skin') {
  s.ellipse(12, 6 + f, 3, 3, mat);
  face(s, 12, 7 + f);
}

// ---------------------------------------------------------------------------------------------
export function peasant(team, f) {
  const s = base(team);
  const dy = f;
  // pitchfork (behind)
  s.line(20, 5 + dy, 20, 21, 'wood');
  s.rect(18, 2 + dy, 1, 3, 'steel');
  s.rect(20, 1 + dy, 1, 4, 'steel');
  s.rect(22, 2 + dy, 1, 3, 'steel');
  s.rect(18, 4 + dy, 5, 1, 'steel');
  body(s, f, { torso: 'robe', legs: 'leather', boots: 'soilWet' });
  s.rect(8, 15 + dy, 8, 2, 'team'); // sash
  s.px(19, 16 + dy, 'skin');
  s.px(20, 16 + dy, 'skin');
  s.rect(17, 12 + dy, 3, 1, 'robe'); // arm reaching to fork
  headAt(s, f);
  // straw hat
  s.ellipse(12, 4 + dy, 5.4, 1.2, 'straw');
  s.ellipse(12, 3 + dy, 3, 1.8, 'straw');
  s.rect(9, 4 + dy, 6, 1, 'team');
  face(s, 12, 7 + dy);
  return s.finish(OUTLINE);
}

// ---------------------------------------------------------------------------------------------
function horse(s, f, { coat = 'horse', galloping = true } = {}) {
  const g = galloping ? f : 0;
  // tail
  s.line(5, 11, 3, 14 + g, 'mane');
  s.line(5, 12, 3, 16, 'mane');
  // back legs / front legs (alternate on frame 1)
  s.rect(6 - g, 15, 2, 6, coat);
  s.rect(9 + g, 15, 2, 6, coat);
  s.rect(14 - g, 15, 2, 6, coat);
  s.rect(17 + g, 15, 2, 5, coat);
  s.rect(6 - g, 20, 2, 2, 'mane');
  s.rect(9 + g, 20, 2, 2, 'mane');
  s.rect(14 - g, 20, 2, 2, 'mane');
  s.rect(17 + g, 19, 2, 2, 'mane');
  // body, neck, head
  s.ellipse(11, 13, 7, 3.4, coat);
  s.poly([[15, 11], [19, 4], [22, 6], [18, 14]], coat);
  s.poly([[19, 5], [23, 8], [22, 11], [19, 9]], coat);
  s.line(16, 10, 19, 4, 'mane', 1);
  s.px(19, 3, 'mane');
  s.px(20, 3, coat);
}

export function outrider(team, f) {
  const s = base(team);
  const bob = f;
  horse(s, f);
  // rider (small, leaning forward) with team cloak and a pennant spear
  s.line(13, 9 + bob, 22, 0, 'wood');
  s.poly([[19, 1 + bob], [23, 2 + bob], [20, 4 + bob]], 'team');
  s.rect(9, 7 + bob, 5, 6, 'team'); // cloak
  s.rect(10, 8 + bob, 4, 3, 'leather');
  s.ellipse(12, 5 + bob, 2.2, 2.2, 'skin');
  s.px(13, 5 + bob, INK);
  s.rect(10, 2 + bob, 5, 2, 'team'); // cap
  s.px(15, 3 + bob, 'team');
  s.px(14, 10 + bob, 'skin');
  return s.finish(OUTLINE);
}

export function knight(team, f) {
  const s = base(team);
  const bob = f;
  horse(s, f, { coat: 'horseWhite' });
  // caparison (team-colour barding)
  s.rect(6, 11, 11, 6, 'team');
  s.rect(6, 16, 11, 1, 'gold');
  s.px(11, 14, 'gold');
  s.px(12, 13, 'gold');
  s.px(12, 15, 'gold');
  // chamfron (face plate)
  s.rect(20, 5, 3, 2, 'steel');
  s.px(22, 7, 'steel');
  // rider in plate
  s.rect(9, 3 + bob, 6, 9, 'steel');
  s.rect(10, 2 + bob, 4, 4, 'steel'); // helm
  s.rect(11, 4 + bob, 3, 1, INK); // visor slit
  s.px(12, 0 + bob, 'team');
  s.rect(11, 1 + bob, 2, 1, 'team'); // plume
  s.rect(9, 9 + bob, 6, 2, 'team');
  // shield + lance
  s.rect(8, 7 + bob, 3, 4, 'team');
  s.px(9, 8 + bob, 'gold');
  s.line(13, 8 + bob, 23, 8 + bob, 'wood');
  s.rect(21, 7 + bob, 3, 3, 'steel');
  return s.finish(OUTLINE);
}

// ---------------------------------------------------------------------------------------------
export function pikeman(team, f) {
  const s = base(team);
  const dy = f;
  // pike behind the body
  s.line(19, 22, 16, 0, 'wood');
  s.poly([[15, 3], [17, 3], [16, 0]], 'steel');
  body(s, f, { torso: 'team', legs: 'iron', boots: 'iron', sleeve: 'iron' });
  s.rect(8, 10 + dy, 8, 2, 'iron'); // gorget
  s.rect(8, 15 + dy, 8, 1, 'leather'); // belt
  headAt(s, f);
  // kettle helm
  s.ellipse(12, 4 + dy, 3.6, 2.2, 'steel');
  s.rect(7, 5 + dy, 10, 1, 'steel');
  face(s, 12, 7 + dy);
  // round shield
  s.ellipse(6, 14 + dy, 3, 3.4, 'wood');
  s.ellipse(6, 14 + dy, 1.4, 1.6, 'team');
  s.px(6, 14 + dy, 'gold');
  s.px(18, 15 + dy, 'skin');
  return s.finish(OUTLINE);
}

export function crossbowman(team, f) {
  const s = base(team);
  const dy = f;
  s.rect(15, 9 + dy, 2, 6, 'leather'); // quiver
  s.px(15, 8 + dy, 'straw');
  s.px(16, 7 + dy, 'straw');
  body(s, f, { torso: 'team', legs: 'leather', boots: 'soilWet', sleeve: 'leather' });
  s.rect(8, 15 + dy, 8, 1, 'leather');
  headAt(s, f);
  s.ellipse(12, 4 + dy, 3.6, 2.4, 'leather'); // hood
  s.rect(9, 5 + dy, 6, 2, 'leather');
  s.ellipse(12, 7 + dy, 2, 1.6, 'skin');
  face(s, 12, 7 + dy);
  // crossbow
  s.rect(13, 12 + dy, 9, 2, 'wood');
  s.line(21, 8 + dy, 21, 17 + dy, 'steel');
  s.line(21, 8 + dy, 17, 12 + dy, 'cloth');
  s.line(21, 17 + dy, 17, 13 + dy, 'cloth');
  s.px(16, 12 + dy, 'steel');
  s.px(17, 12 + dy, 'steel');
  s.px(17, 12 + dy, 'steel');
  return s.finish(OUTLINE);
}

export function ranger(team, f) {
  const s = base(team);
  const dy = f;
  // longbow (behind, left)
  s.line(5, 2, 3, 7, 'wood');
  s.line(3, 7, 3, 16, 'wood');
  s.line(3, 16, 5, 21, 'wood');
  s.line(5, 2, 5, 21, 'cloth');
  body(s, f, { torso: 'cloak', legs: 'cloak', boots: 'leather', sleeve: 'cloak' });
  s.rect(8, 15 + dy, 8, 1, 'leather');
  s.rect(10, 10 + dy, 4, 1, 'team'); // scarf
  s.px(10, 11 + dy, 'team');
  // quiver
  s.rect(15, 8 + dy, 2, 5, 'leather');
  s.px(15, 7 + dy, 'white');
  s.px(16, 6 + dy, 'white');
  headAt(s, f);
  // hood
  s.ellipse(12, 4.5 + dy, 3.8, 2.8, 'cloak');
  s.rect(8, 5 + dy, 2, 4, 'cloak');
  s.rect(14, 5 + dy, 2, 4, 'cloak');
  s.ellipse(12, 7 + dy, 2, 1.8, 'skin');
  face(s, 12, 7 + dy);
  s.px(14, 3 + dy, 'team'); // feather
  s.px(15, 2 + dy, 'team');
  s.px(5, 14 + dy, 'skin');
  return s.finish(OUTLINE);
}

export function druid(team, f) {
  const s = base(team);
  const dy = f;
  // staff with living-green orb
  s.line(20, 4 + dy, 20, 22, 'wood');
  s.ellipse(20, 3 + dy, 2, 2, 'glowGreen');
  s.px(18, 5 + dy, 'moss');
  s.px(22, 5 + dy, 'moss');
  // robe
  s.poly([[8, 10 + dy], [16, 10 + dy], [18, 22], [6, 22]], 'cloak');
  s.rect(6, 11 + dy, 2, 6, 'cloak');
  s.rect(16, 11 + dy, 2, 6, 'cloak');
  s.rect(7, 20, 10, 2, 'robe'); // hem trim
  s.rect(11, 10 + dy, 2, 9, 'team'); // sash
  s.rect(10, 13 + dy, 4, 1, 'gold');
  s.px(18, 16 + dy, 'skin');
  s.px(19, 16 + dy, 'skin');
  s.px(6, 16 + dy, 'skin');
  headAt(s, f);
  s.ellipse(12, 4.5 + dy, 3.8, 2.6, 'cloak');
  s.rect(8, 5 + dy, 2, 4, 'cloak');
  s.rect(14, 5 + dy, 2, 4, 'cloak');
  s.ellipse(12, 7 + dy, 2, 1.8, 'skin');
  face(s, 12, 7 + dy);
  s.rect(10, 9 + dy, 4, 1, 'hairGrey'); // beard
  // antlers
  s.line(9, 2 + dy, 7, 0, 'bone');
  s.line(8, 1 + dy, 6, 1, 'bone');
  s.line(15, 2 + dy, 17, 0, 'bone');
  s.line(16, 1 + dy, 18, 1, 'bone');
  return s.finish(OUTLINE);
}

export function alchemist(team, f) {
  const s = base(team);
  const dy = f;
  body(s, f, { torso: 'team', legs: 'leather', boots: 'soilWet', sleeve: 'team' });
  s.rect(9, 11 + dy, 6, 6, 'leather'); // apron
  s.rect(10, 13 + dy, 4, 1, 'iron');
  // raised flask
  s.rect(19, 4 + dy, 2, 3, 'steel');
  s.px(19, 3 + dy, 'wood');
  s.px(20, 3 + dy, 'wood');
  s.ellipse(20, 9 + dy, 3, 3, 'poison');
  s.px(19, 8 + dy, '#e8d0ff');
  s.px(22, 5 + dy, 'poison');
  s.px(18, 3 + dy, 'poison');
  s.rect(17, 12 + dy, 2, 1, 'team');
  s.px(18, 12 + dy, 'skin');
  headAt(s, f);
  // wild hair + goggles
  s.rect(8, 3 + dy, 8, 2, 'hairGrey');
  s.px(8, 5 + dy, 'hairGrey');
  s.px(15, 5 + dy, 'hairGrey');
  s.px(10, 2 + dy, 'hairGrey');
  s.px(13, 2 + dy, 'hairGrey');
  s.rect(9, 5 + dy, 6, 1, 'leather');
  s.rect(9, 6 + dy, 2, 2, 'gold');
  s.rect(13, 6 + dy, 2, 2, 'gold');
  s.px(10, 7 + dy, '#8ee8ff');
  s.px(14, 7 + dy, '#8ee8ff');
  return s.finish(OUTLINE);
}

export function sapper(team, f) {
  const s = base(team);
  const dy = f;
  // pickaxe over the shoulder
  s.line(19, 22, 17, 5 + dy, 'wood');
  s.rect(13, 3 + dy, 8, 2, 'iron');
  s.px(12, 4 + dy, 'steel');
  s.px(21, 4 + dy, 'steel');
  // powder keg on the back
  s.rect(4, 11 + dy, 4, 6, 'wood');
  s.rect(4, 12 + dy, 4, 1, 'iron');
  s.rect(4, 15 + dy, 4, 1, 'iron');
  s.px(5, 10 + dy, 'glowOrange');
  s.px(6, 9 + dy, 'gold');
  body(s, f, { torso: 'team', legs: 'iron', boots: 'iron', sleeve: 'leather' });
  s.rect(8, 15 + dy, 8, 1, 'leather');
  s.rect(10, 12 + dy, 4, 2, 'leather');
  s.px(18, 15 + dy, 'skin');
  headAt(s, f);
  // hard hat with lamp
  s.ellipse(12, 4 + dy, 3.8, 2.2, 'iron');
  s.rect(7, 5 + dy, 10, 1, 'iron');
  s.rect(11, 2 + dy, 2, 2, 'glowOrange');
  s.px(12, 1 + dy, 'gold');
  face(s, 12, 7 + dy);
  return s.finish(OUTLINE);
}

export function griffinRider(team, f) {
  const s = base(team);
  const up = f === 0;
  // far wing
  if (up) s.poly([[9, 8], [3, 0], [11, 3], [14, 8]], 'horseWhite');
  else s.poly([[9, 10], [2, 15], [10, 12], [14, 10]], 'horseWhite');
  // lion hindquarters + tail
  s.ellipse(8, 14, 4.5, 3, 'gold');
  s.line(4, 14, 1, 18, 'gold');
  s.rect(0, 18, 2, 2, 'straw');
  s.rect(6, 17, 2, 4, 'gold');
  s.rect(10, 17, 2, 4, 'gold');
  s.rect(5, 20, 3, 2, 'straw');
  s.rect(10, 20, 3, 2, 'straw');
  // eagle chest, neck, head
  s.ellipse(14, 12, 4, 3.4, 'horseWhite');
  s.poly([[14, 9], [18, 4], [21, 6], [18, 12]], 'horseWhite');
  s.ellipse(19, 5, 2.4, 2.2, 'horseWhite');
  s.poly([[20, 5], [24, 7], [21, 8]], 'gold');
  s.px(19, 4, INK);
  s.rect(15, 16, 2, 4, 'gold');
  s.rect(15, 20, 3, 2, 'straw');
  // rider on its back
  s.rect(9, 6, 4, 5, 'team');
  s.ellipse(11, 4, 2, 2, 'skin');
  s.px(12, 4, INK);
  s.rect(9, 2, 5, 2, 'steel');
  s.px(11, 1, 'team');
  s.line(13, 8, 20, 10, 'wood');
  // near wing
  if (up) s.poly([[8, 9], [1, 3], [3, 11], [10, 11]], 'white');
  else s.poly([[8, 11], [1, 20], [5, 21], [11, 13]], 'white');
  s.line(up ? 2 : 2, up ? 4 : 19, 8, up ? 9 : 11, 'horseWhite');
  return s.finish(OUTLINE);
}

export const UNIT_ART = {
  peasant,
  outrider,
  knight,
  pikeman,
  crossbowman,
  ranger,
  druid,
  alchemist,
  sapper,
  griffin_rider: griffinRider
};
