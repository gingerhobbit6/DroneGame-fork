// A new way to fire, or a new kind of weapon, has to be handled in several places that would otherwise each fall back quietly
// to a guess. These tests make adding one fail until those places have been looked at.

import { describe, expect, it } from 'vitest';
import { STRUCTURES } from '../src/sim/config/index.js';
import { FIRE_MODES } from '../src/sim/effectors.js';

const effectors = Object.values(STRUCTURES).filter((d) => d.role === 'effector');

describe('a new kind of weapon', () => {
  it('fires in a way the effectors know', () => {
    for (const def of effectors) expect(FIRE_MODES, def.id).toContain(def.fire);
  });

  it('is caught here when it brings a new way to fire', () => {
    // A new mode also needs deciding in: site-range.js flies (sight line, range, catching its target), tasking.js (soft kill
    // first, cost and chance), magazine.js and stats.js (rounds or seconds), structure-view.js (its beam), and the Unit panel.
    expect(FIRE_MODES).toEqual(['beam', 'guided', 'jam']);
  });

  it('is caught here when its rounds would be drawn as a missile by default', () => {
    // render/effects.js draws a gun's tracer, an interceptor drone, and a smoky missile for anything else that flies
    expect([...new Set(effectors.filter((d) => d.fire === 'guided').map((d) => d.kind))].sort()).toEqual(['gun', 'interceptor', 'missile']);
  });
});
