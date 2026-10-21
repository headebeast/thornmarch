import fs from 'fs';
import path from 'path';

const AEII_ROOT = 'D:/Codes D side/Reverse Engineer/AncientEmpires/project_aeii';
const WEB_ROOT = 'D:/Codes D side/Reverse Engineer/AncientEmpires/ancient-empires-web';
const PUBLIC_DIR = path.join(WEB_ROOT, 'public');
const DATA_OUT = path.join(PUBLIC_DIR, 'data');

fs.mkdirSync(DATA_OUT, { recursive: true });

// 1. Parse en_US.dat language strings
const langRaw = fs.readFileSync(path.join(AEII_ROOT, 'android/assets/lang/en_US.dat'), 'utf8');
const lang = {};
for (const line of langRaw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx > 0) {
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    lang[key] = val;
  }
}

// 2. Parse Tiles (core/resources/data/tiles/tile_config.dat + tile_0..N.dat)
const tileConfigRaw = fs.readFileSync(path.join(AEII_ROOT, 'core/resources/data/tiles/tile_config.dat'), 'utf8').trim();
const tileCount = parseInt(tileConfigRaw.split(/\s+/)[0], 10);
const tiles = [];

for (let i = 0; i < tileCount; i++) {
  const raw = fs.readFileSync(path.join(AEII_ROOT, `core/resources/data/tiles/tile_${i}.dat`), 'utf8').trim();
  const tokens = raw.split(/\s+/);
  let ptr = 0;
  const nextInt = () => parseInt(tokens[ptr++], 10);
  const nextBool = () => tokens[ptr++] === 'true';

  const defenceBonus = nextInt();
  const stepCost = nextInt();
  const hpRecovery = nextInt();
  const type = nextInt(); // 0=LAND, 1=WATER, 2=FOREST, 3=MOUNTAIN
  const topTileIndex = nextInt();
  const team = nextInt();

  const accessTileCount = nextInt();
  const accessTileList = [];
  if (accessTileCount > 0) {
    for (let n = 0; n < accessTileCount; n++) {
      accessTileList.push(nextInt());
    }
  }

  const isCapturable = nextBool();
  const capturedTileList = [];
  if (isCapturable) {
    for (let t = 0; t < 5; t++) {
      capturedTileList.push(nextInt());
    }
  }

  const isDestroyable = nextBool();
  const destroyedTileIndex = isDestroyable ? nextInt() : -1;

  const isRepairable = nextBool();
  const repairedTileIndex = isRepairable ? nextInt() : -1;

  const isAnimated = nextBool();
  const animationTileIndex = isAnimated ? nextInt() : -1;

  const miniMapIndex = nextInt();
  const isCastle = nextBool();
  const isVillage = nextBool();
  const isTemple = ptr < tokens.length ? nextBool() : false;

  tiles.push({
    index: i,
    defenceBonus,
    stepCost,
    hpRecovery,
    type,
    topTileIndex,
    team,
    accessTileList,
    isCapturable,
    capturedTileList,
    isDestroyable,
    destroyedTileIndex,
    isRepairable,
    repairedTileIndex,
    isAnimated,
    animationTileIndex,
    miniMapIndex,
    isCastle,
    isVillage,
    isTemple
  });
}

// 3. Parse Units (core/resources/data/units/unit_config.json + unit_0..18.json)
const unitConfig = JSON.parse(fs.readFileSync(path.join(AEII_ROOT, 'core/resources/data/units/unit_config.json'), 'utf8'));
const units = [];
for (let i = 0; i < unitConfig.unit_count; i++) {
  const uData = JSON.parse(fs.readFileSync(path.join(AEII_ROOT, `core/resources/data/units/unit_${i}.json`), 'utf8'));
  units.push({
    index: i,
    name: lang[`UNIT_NAME_${i}`] || `Unit ${i}`,
    description: lang[`UNIT_DESCRIPTION_${i}`] || '',
    guide: lang[`UNIT_GUIDE_${i}`] || '',
    isCommander: i === unitConfig.commander_index,
    isSkeleton: i === unitConfig.skeleton_index,
    isCrystal: i === unitConfig.crystal_index,
    ...uData
  });
}

// 4. Parse Abilities
const abilities = [];
for (let i = 0; i < 29; i++) {
  abilities.push({
    id: i,
    name: lang[`ABILITY_NAME_${i}`] || `Ability ${i}`,
    description: lang[`ABILITY_DESCRIPTION_${i}`] || ''
  });
}

// 5. Binary .aem Map Parser (matches MapFactory.java DataInputStream)
function parseAemFile(filePath, id, category, displayName) {
  const buf = fs.readFileSync(filePath);
  let offset = 0;

  // DataInputStream.readUTF(): 2-byte unsigned big-endian length + UTF-8 string
  const utfLen = buf.readUInt16BE(offset);
  offset += 2;
  const author = buf.subarray(offset, offset + utfLen).toString('utf8');
  offset += utfLen;

  const teamAccess = [];
  for (let t = 0; t < 4; t++) {
    teamAccess.push(buf.readUInt8(offset) !== 0);
    offset += 1;
  }

  const width = buf.readInt32BE(offset);
  offset += 4;
  const height = buf.readInt32BE(offset);
  offset += 4;

  // tiles[x][y] stored column-major in MapFactory.java (for x=0..width-1, for y=0..height-1)
  const grid = Array.from({ length: width }, () => Array(height).fill(0));
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      grid[x][y] = buf.readInt16BE(offset);
      offset += 2;
    }
  }

  const unitCount = buf.readInt32BE(offset);
  offset += 4;
  const mapUnits = [];
  for (let u = 0; u < unitCount; u++) {
    const team = buf.readInt32BE(offset); offset += 4;
    const index = buf.readInt32BE(offset); offset += 4;
    const x = buf.readInt32BE(offset); offset += 4;
    const y = buf.readInt32BE(offset); offset += 4;
    mapUnits.push({ team, index, x, y });
  }

  return {
    id,
    name: displayName,
    category,
    author: author || 'Macrospace / ToyKnight',
    teamAccess,
    maxPlayers: teamAccess.filter(Boolean).length || 2,
    width,
    height,
    tiles: grid,
    units: mapUnits
  };
}

const maps = [];
// Skirmish maps
const mapDir = path.join(AEII_ROOT, 'android/assets/map');
for (const entry of fs.readdirSync(mapDir)) {
  if (entry.endsWith('.aem')) {
    const cleanName = entry.replace(/\.aem$/i, '');
    maps.push(parseAemFile(path.join(mapDir, entry), `skirmish_${cleanName}`, 'skirmish', cleanName));
  }
}

// Campaign maps
const campDir = path.join(mapDir, 'campaign');
const campaignDefs = [
  // Ancient Empires II: Battle of Thorin (8 stages)
  ...Array.from({ length: 8 }, (_, idx) => ({
    file: `aeii_c${idx}.aem`,
    id: `aeii_${idx + 1}`,
    campaign: 'Ancient Empires II: Battle of Thorin',
    stageNum: idx + 1,
    name: lang[`CAMPAIGN_AEII_STAGE_${idx + 1}_NAME`] || `AE2 Stage ${idx + 1}`,
    objective: lang[`CAMPAIGN_AEII_STAGE_${idx + 1}_OBJECTIVE`] || lang[`CAMPAIGN_AEII_STAGE_${idx + 1}_OBJECTIVE_1`] || 'Defeat all enemies!',
    dialogs: Array.from({ length: 16 }, (_, m) => lang[`CAMPAIGN_AEII_STAGE_${idx + 1}_MESSAGE_${m + 1}`]).filter(Boolean)
  })),
  // Ancient Empires I: Battle of Thorin Prequel (7 stages)
  ...Array.from({ length: 7 }, (_, idx) => ({
    file: `aei_c${idx}.aem`,
    id: `aei_${idx + 1}`,
    campaign: 'Ancient Empires I: Prequel',
    stageNum: idx + 1,
    name: lang[`CAMPAIGN_AEI_STAGE_${idx + 1}_NAME`] || `AE1 Stage ${idx + 1}`,
    objective: lang[`CAMPAIGN_AEI_STAGE_${idx + 1}_OBJECTIVE`] || lang[`CAMPAIGN_AEI_STAGE_${idx + 1}_OBJECTIVE_1`] || 'Defeat all enemies!',
    dialogs: Array.from({ length: 10 }, (_, m) => lang[`CAMPAIGN_AEI_STAGE_${idx + 1}_MESSAGE_${m + 1}`]).filter(Boolean)
  })),
  // Tutorial (3 stages)
  ...Array.from({ length: 3 }, (_, idx) => ({
    file: `tutorial_stage_${idx + 1}.aem`,
    id: `tutorial_${idx + 1}`,
    campaign: 'Tutorial Bootcamp',
    stageNum: idx + 1,
    name: lang[`CAMPAIGN_TUTORIAL_STAGE_${idx + 1}_NAME`] || `Tutorial ${idx + 1}`,
    objective: lang[`CAMPAIGN_TUTORIAL_STAGE_${idx + 1}_OBJECTIVE_1`] || 'Defeat all enemies!',
    dialogs: Array.from({ length: 12 }, (_, m) => lang[`CAMPAIGN_TUTORIAL_STAGE_${idx + 1}_MESSAGE_${m + 1}`]).filter(Boolean)
  })),
  // Challenge (5 stages)
  ...Array.from({ length: 5 }, (_, idx) => ({
    file: `challenge_stage_${idx + 1}.aem`,
    id: `challenge_${idx + 1}`,
    campaign: 'Challenge Mode',
    stageNum: idx + 1,
    name: lang[`CAMPAIGN_CHALLENGE_STAGE_${idx + 1}_NAME`] || `Challenge ${idx + 1}`,
    objective: lang[`CAMPAIGN_CHALLENGE_STAGE_${idx + 1}_OBJECTIVE_1`] || 'Defeat all enemies!',
    dialogs: Array.from({ length: 5 }, (_, m) => lang[`CAMPAIGN_CHALLENGE_STAGE_${idx + 1}_MESSAGE_${m + 1}`]).filter(Boolean)
  })),
  // Warroom (4 stages)
  ...Array.from({ length: 4 }, (_, idx) => ({
    file: `warroom_stage_${idx + 1}.aem`,
    id: `warroom_${idx + 1}`,
    campaign: "BW's Warroom",
    stageNum: idx + 1,
    name: lang[`CAMPAIGN_WARROOM_STAGE_${idx + 1}_NAME`] || `Warroom ${idx + 1}`,
    objective: lang[`CAMPAIGN_WARROOM_STAGE_${idx + 1}_OBJECTIVE_1`] || 'Defeat all enemies!',
    dialogs: Array.from({ length: 8 }, (_, m) => lang[`CAMPAIGN_WARROOM_STAGE_${idx + 1}_MESSAGE_${m + 1}`]).filter(Boolean)
  }))
];

for (const c of campaignDefs) {
  const fp = path.join(campDir, c.file);
  if (fs.existsSync(fp)) {
    const parsed = parseAemFile(fp, c.id, 'campaign', c.name);
    parsed.campaign = c.campaign;
    parsed.stageNum = c.stageNum;
    parsed.objective = c.objective;
    parsed.dialogs = c.dialogs;
    maps.push(parsed);
  }
}

fs.writeFileSync(path.join(DATA_OUT, 'tiles.json'), JSON.stringify(tiles, null, 2));
fs.writeFileSync(path.join(DATA_OUT, 'units.json'), JSON.stringify({ config: unitConfig, units }, null, 2));
fs.writeFileSync(path.join(DATA_OUT, 'abilities.json'), JSON.stringify(abilities, null, 2));
fs.writeFileSync(path.join(DATA_OUT, 'maps.json'), JSON.stringify(maps, null, 2));

// 6. Copy images & audio assets to public/assets
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

copyDirSync(path.join(AEII_ROOT, 'android/assets/images'), path.join(PUBLIC_DIR, 'assets/images'));
copyDirSync(path.join(AEII_ROOT, 'android/assets/audio'), path.join(PUBLIC_DIR, 'assets/audio'));

console.log(`Exported ${tiles.length} tiles, ${units.length} units, ${abilities.length} abilities, and ${maps.length} maps!`);
