import { describe, it, expect } from 'vitest';
import { createDefaultProfile } from '../src/game/systems/ProfileStore';
import { craftBita, craftOptions, forgePoints, upgradeBita, upgradeCost } from '../src/game/systems/Forge';
import { getBita } from '../src/game/data/Bitas';
import { FORGE } from '../src/game/Constants';

describe('Forge (S4 meta)', () => {
  it('computes forge points from duplicate copies only', () => {
    const p = createDefaultProfile();
    p.inventory['chupa_red'] = 3;
    p.inventory['mk_raiden'] = 2;
    expect(forgePoints(p)).toBe(7);
  });

  it('refuses to craft below the point cost', () => {
    const p = createDefaultProfile();
    const crown = getBita('bit_crown');
    expect(craftOptions(p).length).toBe(6);
    expect(craftOptions(p).some((o) => o.bita.id === 'bit_crown')).toBe(true);
    const cost = Math.ceil(crown.price / FORGE.CRAFT_DIVISOR);
    expect(cost).toBeGreaterThan(forgePoints(p));
    const res = craftBita(p, 'bit_crown');
    if (!res.ok) expect(res.reason).toBe('poor');
    else throw new Error('expected refusal');
  });

  it('crafts an unowned bita from duplicates and records it as owned', () => {
    const p = createDefaultProfile();
    p.inventory['mk_raiden'] = 40; // 39 × 5 = 195 points ≥ plastic craft cost (30)
    const res = craftBita(p, 'bit_plastic');
    expect(res.ok).toBe(true);
    if (res.ok) expect(p.ownedBitas).toContain('bit_plastic');
    expect(p.ownedBitas).toContain('bit_plastic');
  });

  it('upgrades a bita with duplicates and clamps at the max level', () => {
    const p = createDefaultProfile();
    p.ownedBitas = ['bit_star'];
    p.bitaLevels['bit_star'] = 1;
    expect(upgradeCost(1)).toBe(20);
    p.inventory['chupa_red'] = 60; // 59 points ≥ 20 and ≥ 32
    const res = upgradeBita(p, 'bit_star');
    expect(res.ok).toBe(true);
    expect(p.bitaLevels['bit_star']).toBe(2);
    expect(upgradeBita(p, 'bit_star').ok).toBe(true);
    expect(p.bitaLevels['bit_star']).toBe(3);
    p.bitaLevels['bit_star'] = FORGE.MAX_LEVEL;
    expect(upgradeBita(p, 'bit_star').ok).toBe(false);
  });

  it('lists craftable options with affordability', () => {
    const p = createDefaultProfile();
    p.ownedBitas = ['bit_plastic'];
    const options = craftOptions(p);
    expect(options.length).toBe(5);
    expect(options.some((o) => o.bita.id === 'bit_star')).toBe(true);
  });
});
