// Where the wizard suggests a system goes, judged against the simulation's own coverage and on more than one piece of ground.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { slideToShow } from '../src/render/placement.js';
import { STRUCTURES, resetAllFigures } from '../src/sim/config/index.js';
import { createSimulation } from '../src/sim/simulation.js';
import { suggestSpot } from '../src/ui/assistant/spots.js';
import { zoneShare } from '../src/ui/coverage.js';
import { ringZone } from '../src/zone.js';

const north = { points: [[-30, -110], [30, -110], [30, -50], [-30, -50]], closed: true }; // 1 to 2.2 km north of the site, in scene units

let sim;
const fresh = (terrain = '1') => { sim = createSimulation({ seed: '1', terrainSeed: terrain }); sim.commands.deploy('1', terrain); };
const placeBest = (id, zone = null) => {
  const spot = suggestSpot(sim, STRUCTURES[id], zone);
  expect(sim.commands.place(id, spot.x, spot.z)).toBeNull();
  return spot;
};

beforeEach(() => { resetAllFigures(); fresh(); });

describe('sensors', () => {
  it('judges an empty laydown on the low flyers, which are the hardest to see', () => {
    expect(suggestSpot(sim, STRUCTURES.radar).why).toContain('Fibre-optic strike drone');
  });

  it('follows the zone the player drew', () => {
    const spot = placeBest('radar', north);
    expect(spot.z).toBeLessThan(0); // north of the site
    expect(zoneShare(sim, 'spotter', north)).toBeGreaterThan(0.6); // a spotter close overhead is above the radar's beam
    expect(suggestSpot(sim, STRUCTURES.rf, north).why).toMatch(/your zone/i);
  });

  it('treats a thin zone that falls between the grid lines as its middle', () => {
    const sliver = { points: [[-60, -60], [60, -60.1], [60, -60.2]], closed: true };
    expect(suggestSpot(sim, STRUCTURES.radar, sliver)).not.toBeNull();
  });

  it('never suggests an RF detector on the drones it cannot hear', () => {
    expect(suggestSpot(sim, STRUCTURES.rf).why).not.toMatch(/Fibre-optic strike drone|Fixed-wing strike drone/);
  });

  it('puts a camera where another sensor can cue it, and says when none can', () => {
    expect(suggestSpot(sim, STRUCTURES.camera).why).toContain('No other sensor can cue it');
    placeBest('radar');
    expect(suggestSpot(sim, STRUCTURES.camera).why).toContain('where another sensor can cue it');
  });
});

describe('effectors', () => {
  it('judges a missile on the fixed-wing drones it is kept for', () => {
    expect(suggestSpot(sim, STRUCTURES.missile).why).toMatch(/Fixed-wing strike drone|Fixed-wing spotter drone/);
  });

  it('puts a short-reach jammer inside a zone away from the site', () => {
    const spot = placeBest('jammer', north);
    expect(spot.z).toBeLessThan(-40);
  });
});

describe('a whole laydown', () => {
  it('says plainly when another of the same adds nothing new', () => {
    const zone = ringZone(800);
    for (let i = 0; i < 2; i++) placeBest('interceptor', zone);
    expect(suggestSpot(sim, STRUCTURES.interceptor, zone).why).toContain('already covered');
  });
});

describe('what it can say', () => {
  it('says when a second layer leaves a gap', () => {
    const spy = vi.spyOn(sim.net, 'pd').mockImplementation(() => 0);
    expect(suggestSpot(sim, STRUCTURES.radar).why).toContain('cannot cover');
    spy.mockRestore();
  });

  it('says when it adds a layer but no new cover', () => {
    placeBest('radar');
    const { pd } = sim.net;
    // the placed radar keeps what it sees, and anywhere new sees only what that radar already does
    const placed = sim.structures[0];
    const spy = vi.spyOn(sim.net, 'pd').mockImplementation((s, probe, opts) => pd(placed, probe, opts));
    const why = suggestSpot(sim, STRUCTURES.radar).why;
    expect(why).toContain('no new cover');
    spy.mockRestore();
  });
});

describe('showing the spot', () => {
  const W = 1000, H = 800;
  const camera = (y, look) => {
    const c = new PerspectiveCamera(55, W / H, 0.5, 4000);
    c.position.set(0, y, y === 300 ? 380 : 0); c.lookAt(...look); c.updateMatrixWorld(); c.updateProjectionMatrix();
    return c;
  };

  it('slides the camera so the spot lands where it was asked to', () => {
    const c = camera(300, [0, 0, 0]), spot = { x: -40, y: 5, z: 25 };
    const slide = slideToShow(c, spot.x, spot.y, spot.z, 700, 400, W, H);
    c.position.x += slide.x; c.position.z += slide.z; c.updateMatrixWorld();
    const p = new Vector3(spot.x, spot.y, spot.z).project(c);
    expect(((p.x + 1) / 2) * W).toBeCloseTo(700, 3);
    expect(((1 - p.y) / 2) * H).toBeCloseTo(400, 3);
  });

  it('gives up if that place on the screen looks at the sky', () => {
    expect(slideToShow(camera(10, [100, 10, 0]), 0, 0, 0, 500, 10, W, H)).toBeNull();
  });
});

describe('what it will not do', () => {
  it('suggests nothing once the laydown is locked or the budget is gone', () => {
    sim.state.budget = 0;
    expect(suggestSpot(sim, STRUCTURES.radar)).toBeNull();
  });

  it('gives the same answer twice, and changes nothing', () => {
    placeBest('radar');
    const before = sim.digest(), logged = sim.log.length;
    expect(suggestSpot(sim, STRUCTURES.rf)).toEqual(suggestSpot(sim, STRUCTURES.rf));
    expect(sim.digest()).toBe(before);
    expect(sim.log.length).toBe(logged);
  });
});
