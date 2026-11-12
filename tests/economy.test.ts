import { describe, it, expect } from 'vitest';
import {
  addChips,
  canAfford,
  spendChips,
  addChip,
  removeChip,
  totalChips,
  uniqueChips,
  buyBita,
  equipBita,
  sellChip,
  SELL_RATE,
} from '../src/game/systems/Economy';
import { createDefaultProfile } from '../src/game/systems/ProfileStore';
import { getChip } from '../src/game/data/Chips';
import { getBita } from '../src/game/data/Bitas';

describe('Economy', () => {
  it('adds and spends chips', () => {
    const p = createDefaultProfile();
    p.balance = 100;
    addChips(p, 50);
    expect(p.balance).toBe(150);
    expect(canAfford(p, 150)).toBe(true);
    expect(spendChips(p, 160)).toBe(false);
    expect(spendChips(p, 30)).toBe(true);
    expect(p.balance).toBe(120);
  });

  it('manages inventory', () => {
    const p = createDefaultProfile();
    addChip(p, 'chupa_red');
    addChip(p, 'chupa_red', 2);
    addChip(p, 'mk_scorpion');
    expect(uniqueChips(p)).toBe(2);
    expect(totalChips(p)).toBe(4);
    expect(removeChip(p, 'chupa_red', 10)).toBe(3);
  });

  it('buys and equips a bita', () => {
    const p = createDefaultProfile();
    const b = getBita('bit_plastic');
    p.balance = 100;
    expect(buyBita(p, b.id).ok).toBe(false);
    p.balance = b.price;
    expect(buyBita(p, b.id).ok).toBe(true);
    expect(equipBita(p, 'bit_fire')).toBe(false);
    expect(equipBita(p, b.id)).toBe(true);
    expect(equipBita(p, null)).toBe(true);
  });

  it('sells chips at SELL_RATE', () => {
    const p = createDefaultProfile();
    p.balance = 0;
    addChip(p, 'gold_coin', 3);
    const def = getChip('gold_coin');
    const s = sellChip(p, def.id, 2);
    expect(s.sold).toBe(2);
    expect(s.credited).toBe(Math.floor(2 * def.value * SELL_RATE));
    expect(p.balance).toBe(s.credited);
  });
});
