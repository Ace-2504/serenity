/**
 * Deterministic pseudo-random numbers for the demo generator. Math.random is never used:
 * the same seed must always produce byte-identical datasets.
 *
 * fork(label) derives an independent stream from (seed, label), so adding draws in one
 * part of the generator does not shift the numbers another part receives.
 */
export type Rng = {
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  chance(probability: number): boolean;
  pick<T>(values: readonly T[]): T;
  weightedIndex(weights: readonly number[]): number;
  normal(mean: number, sd: number): number;
  poisson(lambda: number): number;
  logUniform(min: number, max: number): number;
  fork(label: string): Rng;
};

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number, label = "root"): Rng {
  const next = mulberry32(fnv1a(`${seed}:${label}`));

  const rng: Rng = {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    chance(probability) {
      return next() < probability;
    },
    pick(values) {
      if (values.length === 0) {
        throw new Error("Cannot pick from an empty list");
      }
      return values[Math.floor(next() * values.length)];
    },
    weightedIndex(weights) {
      const total = weights.reduce((sum, w) => sum + w, 0);
      if (total <= 0) {
        return -1;
      }
      let target = next() * total;
      for (let i = 0; i < weights.length; i += 1) {
        target -= weights[i];
        if (target < 0) {
          return i;
        }
      }
      return weights.length - 1;
    },
    normal(mean, sd) {
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    poisson(lambda) {
      if (lambda <= 0) {
        return 0;
      }
      // Knuth's method; lambdas here are small (orders per party per day).
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= next();
      } while (p > limit);
      return k - 1;
    },
    logUniform(min, max) {
      return Math.exp(Math.log(min) + next() * (Math.log(max) - Math.log(min)));
    },
    fork(childLabel) {
      return createRng(seed, `${label}/${childLabel}`);
    }
  };

  return rng;
}
