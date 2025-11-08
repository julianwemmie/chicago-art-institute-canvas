import { MAX_SECTORS, SECTOR_SIZE } from '../constants';

export type TileState = 'empty' | 'ready' | 'error';

export interface Tile {
  state: TileState;
  artworkIndex?: number;
}

export interface Sector {
  key: string;
  sx: number;
  sy: number;
  tiles: Tile[];
  touchedAt: number;
}

export interface SectorBounds {
  minSx: number;
  maxSx: number;
  minSy: number;
  maxSy: number;
}

export function sectorKey(sx: number, sy: number): string {
  return `${sx}:${sy}`;
}

function createEmptyTile(): Tile {
  return { state: 'empty' };
}

function createTileArray(): Tile[] {
  return Array.from({ length: SECTOR_SIZE * SECTOR_SIZE }, createEmptyTile);
}

export function worldToSectorCoordinate(value: number): number {
  return Math.floor(value / SECTOR_SIZE);
}

export function worldToLocalIndex(value: number): number {
  const mod = value % SECTOR_SIZE;
  return mod < 0 ? mod + SECTOR_SIZE : mod;
}

export function tileIndex(localCol: number, localRow: number): number {
  return localRow * SECTOR_SIZE + localCol;
}

export class SectorStore {
  private readonly sectors = new Map<string, Sector>();
  private readonly order = new Map<string, true>();
  private bounds: SectorBounds | null = null;

  constructor(private readonly maxSectors: number = MAX_SECTORS) {}

  get size(): number {
    return this.sectors.size;
  }

  getOrCreate(sx: number, sy: number): { sector: Sector; isNew: boolean } {
    const key = sectorKey(sx, sy);
    const existing = this.sectors.get(key);
    if (existing) {
      this.touch(key);
      return { sector: existing, isNew: false };
    }

    const sector: Sector = {
      key,
      sx,
      sy,
      tiles: createTileArray(),
      touchedAt: Date.now(),
    };

    this.sectors.set(key, sector);
    this.touch(key);
    this.updateBoundsForSector(sector);
    return { sector, isNew: true };
  }

  touch(key: string): void {
    const sector = this.sectors.get(key);
    if (!sector) {
      return;
    }

    sector.touchedAt = Date.now();
    if (this.order.has(key)) {
      this.order.delete(key);
    }
    this.order.set(key, true);
  }

  evictIfNeeded(): void {
    let removed = false;
    while (this.sectors.size > this.maxSectors) {
      const iterator = this.order.keys();
      const oldestKey = iterator.next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.order.delete(oldestKey);
      this.sectors.delete(oldestKey);
      removed = true;
    }

    if (removed) {
      this.recalculateBounds();
    }
  }

  values(): IterableIterator<Sector> {
    return this.sectors.values();
  }

  getBounds(): SectorBounds | null {
    return this.bounds ? { ...this.bounds } : null;
  }

  private updateBoundsForSector(sector: Sector): void {
    if (!this.bounds) {
      this.bounds = {
        minSx: sector.sx,
        maxSx: sector.sx,
        minSy: sector.sy,
        maxSy: sector.sy,
      };
      return;
    }

    this.bounds.minSx = Math.min(this.bounds.minSx, sector.sx);
    this.bounds.maxSx = Math.max(this.bounds.maxSx, sector.sx);
    this.bounds.minSy = Math.min(this.bounds.minSy, sector.sy);
    this.bounds.maxSy = Math.max(this.bounds.maxSy, sector.sy);
  }

  private recalculateBounds(): void {
    if (this.sectors.size === 0) {
      this.bounds = null;
      return;
    }

    let minSx = Infinity;
    let maxSx = -Infinity;
    let minSy = Infinity;
    let maxSy = -Infinity;

    for (const sector of this.sectors.values()) {
      if (sector.sx < minSx) minSx = sector.sx;
      if (sector.sx > maxSx) maxSx = sector.sx;
      if (sector.sy < minSy) minSy = sector.sy;
      if (sector.sy > maxSy) maxSy = sector.sy;
    }

    this.bounds = { minSx, maxSx, minSy, maxSy };
  }
}
