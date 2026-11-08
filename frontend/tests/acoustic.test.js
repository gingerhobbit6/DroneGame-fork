// Acoustic sensors: they hear what radio sensors cannot, need no line of sight, and lose reach to hills and noise.

import { beforeEach, describe, expect, it } from 'vitest';
import { DRONES, STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { heardAt, reachFor } from '../src/sim/network/sensors.js';
import { createSimulation } from '../src/sim/simulation.js';
import { terrainState } from '../src/sim/terrain.js';

let sim, s;
const at = (distanceM, type = 'fpv', altM = 30) => {
  const data = terrainState.data, z = -distanceM / 20;
  return { pos: { x: s.pos.x, y: (data.groundAt(s.pos.x * 20, z * 20) + altM) / 20, z: s.pos.z + z }, def: DRONES[type] };
};

beforeEach(() => {
  resetAllFigures();
  sim = createSimulation({ seed: '1', terrainSeed: '1' });
  s = sim.addStructure('acoustic', 30, 0);
});

describe('what it can hear', () => {
  it('hears the drones an RF detector cannot', () => {
    for (const drone of Object.values(DRONES).filter((d) => !d.rfEmitter)) {
      expect(reachFor(STRUCTURES.rf, drone)).toBe(0);
      expect(reachFor(STRUCTURES.acoustic, drone)).toBeGreaterThan(0);
    }
  });

  it('hears a loud fixed-wing drone further than a quiet quadcopter', () => {
    expect(reachFor(STRUCTURES.acoustic, DRONES.fw)).toBeGreaterThan(reachFor(STRUCTURES.acoustic, DRONES.fpv));
  });

  it('puts the large station at the reported three miles or so against a Fixed-wing strike drone', () => {
    expect(reachFor(STRUCTURES.acoustic_l, DRONES.fw)).toBeGreaterThan(4500);
    expect(reachFor(STRUCTURES.acoustic_l, DRONES.fw)).toBeLessThan(5500);
  });

  it('fades with distance, and is out of reach far beyond its range', () => {
    expect(sim.net.pd(s, at(200))).toBeGreaterThan(sim.net.pd(s, at(450)));
    expect(sim.net.pd(s, at(5000))).toBe(0);
  });
});

describe('what cuts its reach', () => {
  const blocked = (clear, cover) => {
    const data = terrainState.data;
    return Object.create(data, {
      los: { value: () => ({ clear, canopy: 0 }) },
      coverAt: { value: () => cover },
    });
  };
  const withGround = (clear, cover, fn) => {
    const was = terrainState.data;
    terrainState.data = blocked(clear, cover);
    try { return fn(); } finally { terrainState.data = was; }
  };

  it('still hears a drone behind a hill, more faintly, where a radar sees nothing', () => {
    const open = withGround(true, 0, () => sim.net.pd(s, at(400)));
    const hill = withGround(false, 0, () => sim.net.pd(s, at(400)));
    expect(hill).toBeGreaterThan(0);
    expect(hill).toBeLessThan(open);
    // a radar reads the ground itself, so give it a real hill: high ground everywhere but under the radar and the drone
    const radar = sim.addStructure('radar', 60, 0), target = at(400), was = terrainState.data, m = 20;
    const clearOf = (p, x, z) => Math.hypot(x - p.x * m, z - p.z * m) < 100;
    terrainState.data = Object.create(was, { groundAt: { value: (x, z) => (clearOf(radar.pos, x, z) || clearOf(target.pos, x, z) ? 0 : 400) } });
    try { expect(sim.net.pd(radar, target)).toBeLessThan(0.01); } finally { terrainState.data = was; }
  });

  it('hears less in a noisy built-up area', () => {
    expect(withGround(true, 2, () => sim.net.pd(s, at(400)))).toBeLessThan(withGround(true, 0, () => sim.net.pd(s, at(400))));
  });
});

describe('in a run', () => {
  it('reports through SAPIENT as an acoustic node, with a bearing and no range', () => {
    expect(s.def.sapient.nodeType).toBe('NODE_TYPE_ACOUSTIC');
    expect(s.def.sapient.noise.range).toBeUndefined();
    expect(s.def.emits).toEqual([]);
  });
});

describe('every size of every weapon', () => {
  it('has a real product, sources, and rounds or a beam store', () => {
    for (const id of ['interceptor_s', 'interceptor_l', 'missile_s', 'missile_l', 'laser_s', 'laser_l', 'acoustic_s', 'acoustic', 'acoustic_l']) {
      const def = STRUCTURES[id];
      expect(def.product, id).toBeTruthy();
      expect(def.ref.sources.length, id).toBeGreaterThan(0);
      expect(def.ref.basis, id).toBeTruthy();
      expect(def.ref.cost.capex, id).toBeTruthy();
      if (def.role === 'effector') expect(def.magazine, id).toBeGreaterThan(0);
    }
  });

  it('draws a small system smaller than a large one', () => {
    for (const kind of ['interceptor', 'missile', 'laser', 'acoustic']) {
      expect(STRUCTURES[`${kind}_s`].modelScale).toBeLessThan(STRUCTURES[kind].modelScale || 1);
      expect(STRUCTURES[`${kind}_l`].modelScale).toBeGreaterThan(STRUCTURES[kind].modelScale || 1);
    }
  });
});

describe('the speed of sound', () => {
  it('puts a drone where it was when the sound left it: a Shahed a kilometre off, about 146 m back along its path', () => {
    const was = heardAt({ x: 1000, y: 300, z: 0 }, { x: 0, y: 0, z: 50 }, 1000);
    expect(was.x).toBe(1000); expect(was.y).toBe(300);
    expect(was.z).toBeCloseTo(-145.8, 1);
    expect(heardAt({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 1000)).toEqual({ x: 5, y: 0, z: 0 }); // a still drone is where it is heard
  });
});
