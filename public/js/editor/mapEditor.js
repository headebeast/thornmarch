// Map editor model — create, paint, place units, save custom maps. (View lives in ui/editorPanel.js)

import { platform } from '../platform/platform.js';

export class MapEditor {
  constructor(assets) {
    this.assets = assets;
    this.active = false;
    this.brushMode = 'tile'; // 'tile' | 'unit' | 'erase'
    this.selectedTileIndex = 18; // plain ground
    this.selectedUnitIndex = 0; // Soldier default
    this.selectedTeam = 0; // Blue default

    this.map = this.createBlankMap(12, 12, 'Custom Battle');
  }

  createBlankMap(width = 12, height = 12, name = 'Custom Battle') {
    const tiles = Array.from({ length: width }, () => Array(height).fill(18)); // tile 18 = plain ground
    return {
      id: `custom_${Date.now()}`,
      name,
      category: 'skirmish',
      author: 'Custom Commander',
      teamAccess: [true, true, false, false],
      maxPlayers: 2,
      width,
      height,
      tiles,
      units: [
        { team: 0, index: 9, x: 1, y: 1 },
        { team: 1, index: 9, x: width - 2, y: height - 2 }
      ]
    };
  }

  resize(width, height) {
    const w = Math.max(6, Math.min(32, width || 12));
    const h = Math.max(6, Math.min(32, height || 12));
    const newTiles = Array.from({ length: w }, (_, x) =>
      Array.from({ length: h }, (__, y) => (this.map.tiles[x]?.[y] !== undefined ? this.map.tiles[x][y] : 18))
    );
    this.map.width = w;
    this.map.height = h;
    this.map.tiles = newTiles;
    this.map.units = this.map.units.filter(u => u.x < w && u.y < h);
  }

  applyBrush(x, y) {
    if (x < 0 || x >= this.map.width || y < 0 || y >= this.map.height) return;

    if (this.brushMode === 'tile') {
      this.map.tiles[x][y] = this.selectedTileIndex;
    } else if (this.brushMode === 'unit') {
      this.map.units = this.map.units.filter(u => !(u.x === x && u.y === y));
      // Ensure max 1 commander per team
      if (this.selectedUnitIndex === (this.assets.unitConfig?.commander_index ?? 9)) {
        this.map.units = this.map.units.filter(
          u => !(u.team === this.selectedTeam && u.index === this.selectedUnitIndex)
        );
      }
      this.map.units.push({
        team: this.selectedTeam,
        index: this.selectedUnitIndex,
        x,
        y
      });
    } else if (this.brushMode === 'erase') {
      this.map.units = this.map.units.filter(u => !(u.x === x && u.y === y));
    }

    this.recomputeTeams();
  }

  recomputeTeams() {
    const teams = [false, false, false, false];
    for (let x = 0; x < this.map.width; x++) {
      for (let y = 0; y < this.map.height; y++) {
        const t = this.assets.getTile(this.map.tiles[x][y]);
        if (t.isCastle && t.team >= 0 && t.team < 4) teams[t.team] = true;
      }
    }
    for (const u of this.map.units) {
      if (u.team >= 0 && u.team < 4) teams[u.team] = true;
    }
    this.map.teamAccess = teams;
    this.map.maxPlayers = Math.max(2, teams.filter(Boolean).length);
  }

  saveToLocalStorage(mapName) {
    this.map.name = (mapName || this.map.name || 'Custom Map').trim();
    this.map.id = `custom_${this.map.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now()}`;
    this.recomputeTeams();

    const copy = JSON.parse(JSON.stringify(this.map));
    const existing = platform.storage.get('aeii_custom_maps', []);
    existing.push(copy);
    platform.storage.set('aeii_custom_maps', existing);

    this.assets.maps.push(copy);
    return copy;
  }
}
