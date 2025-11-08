import { GLOBAL_SEED } from '../constants';

const BIGINT_MASK_64 = (1n << 64n) - 1n;
const PRIME_X = 1_000_003n;
const PRIME_Y = 1_000_033n;
const PRIME_SEED = 1_928_341n;
const JUMP_MULTIPLIER = 2_862_933_555_777_941_757n;

function normalizeKey(value: bigint): bigint {
  return BigInt.asUintN(64, value & BIGINT_MASK_64);
}

function coordinateKey(col: number, row: number, seed: number): bigint {
  const colPart = BigInt(col) * PRIME_X;
  const rowPart = BigInt(row) * PRIME_Y;
  const seedPart = BigInt(seed) * PRIME_SEED;
  return normalizeKey(colPart ^ rowPart ^ seedPart);
}

function jumpConsistentHash(key: bigint, buckets: number): number {
  if (buckets <= 0) {
    throw new Error('Bucket count must be positive');
  }

  let b = -1;
  let j = 0;
  let current = normalizeKey(key);

  while (j < buckets) {
    b = j;
    current = normalizeKey(current * JUMP_MULTIPLIER + 1n);
    const keyShift = Number(current >> 33n);
    j = Math.floor((b + 1) * (2147483648 / (keyShift + 1))); // 1 << 31
  }

  return b;
}

export function stableArtworkIndex(
  col: number,
  row: number,
  artworkCount: number,
  seed: number = GLOBAL_SEED
): number {
  if (artworkCount <= 0) {
    return -1;
  }

  const key = coordinateKey(col, row, seed);
  return jumpConsistentHash(key, artworkCount);
}
