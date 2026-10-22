// Icon system.
//  • sprite(): the original game's own pixel icons, sliced from its sprite sheets (authentic look)
//  • glyph():  small hand-drawn pixel glyphs rendered as crisp SVG (inherit text colour) for things the
//              original sheets lack (zoom, fullscreen, fit, audio…)

import { h } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---- authentic sprite sheets -------------------------------------------------------------------
const SHEETS = {
  action: { url: '/assets/images/icons_action.png', cell: [16, 16], cols: 8, rows: 1 },
  menu: { url: '/assets/images/icons_main_menu.png', cell: [25, 25], cols: 10, rows: 1 },
  battle: { url: '/assets/images/icons_hud_battle.png', cell: [13, 16], cols: 4, rows: 1 },
  status: { url: '/assets/images/icons_hud_status.png', cell: [11, 11], cols: 3, rows: 1 }
};

/** Named icons -> [sheet, index] */
export const SPRITES = {
  buy: ['action', 0],
  occupy: ['action', 1],
  attack: ['action', 2],
  heal: ['action', 3],
  move: ['action', 4],
  summon: ['action', 6],
  health: ['action', 7],
  sword: ['menu', 0],
  crystal: ['menu', 1],
  orb: ['menu', 2],
  chest: ['menu', 3],
  hammer: ['menu', 4],
  globe: ['menu', 5],
  book: ['menu', 6],
  chat: ['menu', 7],
  tomb: ['menu', 8],
  gem: ['menu', 9],
  atk: ['battle', 0],
  pdef: ['battle', 1],
  mdef: ['battle', 2],
  rank: ['battle', 3],
  person: ['status', 0],
  coin: ['status', 1],
  compass: ['status', 2]
};

export function sprite(name, scale = 2, extraClass = '') {
  const [sheetName, index] = SPRITES[name] || SPRITES.sword;
  const s = SHEETS[sheetName];
  const [cw, ch] = s.cell;
  return h('span', {
    class: `spr ${extraClass}`,
    'aria-hidden': 'true',
    style: {
      width: `${cw * scale}px`,
      height: `${ch * scale}px`,
      backgroundImage: `url(${s.url})`,
      backgroundSize: `${cw * s.cols * scale}px ${ch * s.rows * scale}px`,
      backgroundPosition: `${-index * cw * scale}px 0`
    }
  });
}

// ---- hand-drawn pixel glyphs (SVG, currentColor) ----------------------------------------------
const GLYPHS = {
  zoomIn: ['.####....', '#....#...', '#..#.#...', '#.###.#..', '#..#.##..', '.####.##.', '......###', '.......##'],
  zoomOut: ['.####....', '#....#...', '#....#...', '#.###.#..', '#....##..', '.####.##.', '......###', '.......##'],
  fit: ['#########', '#.......#', '#.#####.#', '#.#...#.#', '#.#...#.#', '#.#####.#', '#.......#', '#########'],
  fullscreen: ['####...####', '#.........#', '#..#...#..#', '#...#.#...#', '...........', '#...#.#...#', '#..#...#..#', '#.........#', '####...####'],
  fullscreenExit: ['...#.#...', '...#.#...', '###...###', '.........', '.........', '###...###', '...#.#...', '...#.#...'],
  audioOn: ['....#....', '...##..#.', '###### #.', '######.#.', '###### #.', '...##..#.', '....#....'],
  audioOff: ['....#....', '...##.#.#', '######.#.', '######.#.', '######.#.', '...##.#.#', '....#....'],
  menu: ['.........', '#########', '.........', '#########', '.........', '#########', '.........'],
  close: ['##.....##', '###...###', '.###.###.', '..#####..', '...###...', '..#####..', '.###.###.', '###...###', '##.....##'],
  back: ['...#.....', '..##.....', '.#######.', '########.', '.#######.', '..##.....', '...#.....'],
  play: ['##.......', '####.....', '######...', '########.', '######...', '####.....', '##.......'],
  eye: ['..#####..', '.#.....#.', '#..###..#', '#.#####.#', '#..###..#', '.#.....#.', '..#####..'],
  boot: ['..####...', '..####...', '..####...', '..####...', '#######..', '#########', '#########'],
  target: ['....#....', '..#####..', '.#..#..#.', '.#.###.#.', '##.###.##', '.#.###.#.', '.#..#..#.', '..#####..', '....#....'],
  flag: ['##.......', '#####....', '#######..', '#####....', '#........', '#........', '#........', '#........'],
  plus: ['...#...', '...#...', '...#...', '#######', '...#...', '...#...', '...#...'],
  dice: ['#######', '#.....#', '#.#.#.#', '#.....#', '#.#.#.#', '#.....#', '#######'],
  wheat: ['...#...', '..###..', '.#.#.#.', '...#...', '..###..', '.#.#.#.', '...#...', '...#...', '...#...'],
  skull: ['.#####.', '#######', '#.###.#', '#######', '.#####.', '.#.#.#.'],
  hourglass: ['#######', '.#####.', '..###..', '...#...', '..###..', '.#####.', '#######'],
  chevronRight: ['#.....', '##....', '###...', '####..', '###...', '##....', '#.....'],
  fogEye: ['.#####.', '#.....#', '#.###.#', '#.###.#', '#.....#', '.#####.'],
  sparkle: ['...#...', '...#...', '.#####.', '...#...', '...#...'],
  trophy: ['#######', '#.###.#', '#.###.#', '.#####.', '..###..', '...#...', '..###..'],
  info: ['..###..', '..###..', '.......', '..###..', '..###..', '..###..', '..###..'],
  download: ['...###...', '...###...', '...###...', '.#######.', '..#####..', '...###...', '....#....', '.........', '#########'],
  gear: ['....#....', '.##.#.##.', '.#######.', '..##.##..', '###...###', '..##.##..', '.#######.', '.##.#.##.', '....#....']
};

export function glyph(name, px = 2, extraClass = '') {
  const rows = GLYPHS[name] || GLYPHS.info;
  const w = Math.max(...rows.map(r => r.length));
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${rows.length}`);
  svg.setAttribute('width', w * px);
  svg.setAttribute('height', rows.length * px);
  svg.setAttribute('class', `glyph ${extraClass}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] === '#') {
        let run = x;
        while (run < row.length && row[run] === '#') run++;
        const r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', x);
        r.setAttribute('y', y);
        r.setAttribute('width', run - x);
        r.setAttribute('height', 1);
        r.setAttribute('fill', 'currentColor');
        svg.appendChild(r);
        x = run;
      } else x++;
    }
  });
  return svg;
}
