import { describe, it, expect } from 'vitest';
import { Rng } from '../src/game/Rng';

describe('Rng (mulberry32)', () => {
  it('is reproducible with the same seed', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('int stays within range', () => {
    const rng = new Rng(42);
    for (let i = 0; i < 200; i++) {
      const v = rng.int(0, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(4);
    }
  });

  it('chance bounds', () => {
    const rng = new Rng(1);
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(1)).toBe(true);
  });

  it('shuffle is a permutation', () => {
    const rng = new Rng(99);
    const arr = [0, 1, 2, 3, 4, 5];
    const copy = arr.slice();
    rng.shuffle(arr);
    expect(arr).toHaveLength(copy.length);
    copy.forEach((n) => expect(arr).toContain(n));
  });
});
