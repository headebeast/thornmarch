import { generatedTeamRamp } from '../config/colors.js';

// Shared colour ramps. Each ramp is [deep, dark, mid, light].
// Team ramps are recovered from the original unit sheets (the game recolours with a palette swap).

export const TEAM_RAMPS = [
  ['#0c2c67', '#005bbd', '#388ce9', '#8dd9f4'], // 0 Blue
  ['#55056e', '#970066', '#db1a67', '#f49492'], // 1 Red
  ['#004b48', '#008f2d', '#59b41b', '#a1ed50'], // 2 Green
  ['#001325', '#002040', '#003667', '#006b8b'] // 3 Black
];
export const NEUTRAL_RAMP = ['#2e3542', '#5b6577', '#8492ab', '#c2c9d6'];

const generated = new Map();
export function teamRamp(team) {
  if (team >= 0 && team < TEAM_RAMPS.length) return TEAM_RAMPS[team];
  if (team < 0) return NEUTRAL_RAMP;
  if (!generated.has(team)) generated.set(team, generatedTeamRamp(team));
  return generated.get(team);
}

export const OUTLINE = '#141a26';

/** Base material library shared by every sprite in the pack. */
export const MATERIALS = {
  skin: ['#7a3b24', '#c97a4c', '#f2a877', '#ffd2a8'],
  skinDark: ['#4a2216', '#7a4128', '#a2623c', '#c98b5c'],
  hair: ['#3a1d0c', '#6b3a14', '#a8641e', '#e0a040'],
  hairGrey: ['#3b3f4a', '#6a707e', '#a0a6b4', '#d4d8e0'],
  steel: ['#2e3542', '#5b6577', '#9aa6bc', '#e4ebf5'],
  iron: ['#1f232c', '#3e4553', '#6a7385', '#a5aec0'],
  leather: ['#2e1a0e', '#5a3419', '#8c5a2e', '#c08a52'],
  wood: ['#3a2310', '#6b4423', '#a06a38', '#d09a60'],
  woodPale: ['#5a3d22', '#8c6238', '#c0905a', '#e8c48a'],
  straw: ['#7a5a14', '#b98a1e', '#e8b92e', '#fff08a'],
  cloth: ['#3a3a4a', '#6a6a80', '#a0a0b8', '#d8d8ea'],
  cloak: ['#0e3a22', '#1b6a3a', '#2f9a52', '#7fd68a'],
  robe: ['#3a2a14', '#6e4f26', '#a37a3c', '#d8b068'],
  horse: ['#3a1e0e', '#6a3a1a', '#9a5a2a', '#cc8a4a'],
  horseWhite: ['#7a7468', '#b0a898', '#e0d8c8', '#fffaf0'],
  mane: ['#14100c', '#2e2418', '#4e3c26', '#7a6040'],
  gold: ['#6a4a00', '#b88400', '#f2c01e', '#fff2a0'],
  stone: ['#2e3542', '#5b6577', '#8f9bb0', '#c8d0de'],
  stoneWarm: ['#4a3f38', '#7a6c60', '#a89a8a', '#d6cabb'],
  moss: ['#16401c', '#2a6a2a', '#4e9a38', '#8ed05a'],
  soil: ['#2e1a0e', '#523018', '#7a4a26', '#a8703e'],
  soilWet: ['#241408', '#3e2410', '#5e3a1c', '#84582c'],
  sprout: ['#0e4a1e', '#1f8a2e', '#4ec238', '#a6f060'],
  wheat: ['#6a4a08', '#b0801a', '#e8b83a', '#fff0a0'],
  brick: ['#4a1a1a', '#7a2e2a', '#b0503e', '#e08a68'],
  roofRed: ['#4a0e1a', '#8a1c2e', '#c8384a', '#f27a86'],
  glowGreen: ['#0a5a3a', '#14a468', '#4ce0a0', '#c8ffe0'],
  glowTeal: ['#0a3a5a', '#1470a8', '#4cb8f0', '#d0f0ff'],
  glowOrange: ['#7a2a00', '#d85a10', '#ffa030', '#fff0a0'],
  poison: ['#2a0a4a', '#5a1a9a', '#9a4ae0', '#d8a8ff'],
  bone: ['#6a6450', '#a8a088', '#dcd4bc', '#fffbe8'],
  white: ['#8a92a4', '#c0c8d8', '#eef2f8', '#ffffff'],
  black: ['#07090e', '#10141c', '#1c222e', '#323a4c']
};

/** Materials + the five owner ramps under the names `team` (primary) so art can say 'team'. */
export function withTeam(team, extra = {}) {
  return { ...MATERIALS, team: teamRamp(team), ...extra };
}
