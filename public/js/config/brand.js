// The product's name and description — the ONE place to rename the game.
//
// The game is called Thornmarch. (It started life as a web edition of "Ancient Empires Reloaded", whose name belongs to its
// original publisher — the code is GPL-3 and the art is free to use, the name is not, so this edition has its own.)
// To rename it again: change `name` / `edition` below, rebuild (`npm run build`), and the page title, install name,
// social-share tags, menu logo and About box all follow.
// This file is plain data (no DOM) so the build script reads the very same values.

export const BRAND = {
  name: 'Thornmarch',
  edition: 'Tactics',
  shortName: 'Thornmarch',
  description: 'Classic turn-based tactics, rebuilt for every screen — campaign, skirmish, the Frontier realm and a 60-warband Battle Royale.',
  /** Shown in the About box and the README: who made the game this one is built on. */
  originalProject: { name: 'Ancient Empires Reloaded (aeii)', author: 'toyknight and contributors', url: 'http://toyknight.net/aeii' }
};

export const brandTitle = () => `${BRAND.name} ${BRAND.edition}`;
