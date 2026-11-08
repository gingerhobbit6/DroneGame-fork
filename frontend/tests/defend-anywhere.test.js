// A drawn area replaces the old station: draw it, build around it and be attacked at it, anywhere on the map.

import { beforeEach, describe, expect, it } from 'vitest';
import { BUILD, DRONES, STRUCTURES, WORLD, resetAllFigures } from '../src/sim/config/index.js';
import { inZone, launchPoint } from '../src/sim/attack-area.js';
import { routeProblem } from '../src/sim/patrol.js';
import { createSimulation } from '../src/sim/simulation.js';
import { SITE_POS, hdist, onMap, u } from '../src/sim/units.js';
import { suggestSpot } from '../src/ui/assistant/spots.js';
import { zoneShare } from '../src/ui/coverage.js';
import { addZonePoint } from '../src/zone.js';

const square = (cx, cz, half = 25) => [[cx - half, cz - half], [cx + half, cz - half], [cx + half, cz + half], [cx - half, cz + half]];
const FAR = 300; // scene units: 6 km from the station, past the old 5 km limit and the old 2.5 km build ring
let sim;
beforeEach(() => { resetAllFigures(); sim = createSimulation({ seed: '1', terrainSeed: '1' }); sim.state.started = true; });

// A spot the ground allows near (x, z), since hills, water and buildings can refuse any one spot.
function placeNear(id, x, z) {
  for (const [dx, dz] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20], [20, 20], [-20, -20], [40, 0], [0, 40], [-40, 0], [0, -40]]) {
    if (!sim.commands.place(id, x + dx, z + dz)) return true;
  }
  return false;
}

describe('where an attack starts', () => {
  it('is the same as ever with nothing drawn', () => {
    for (const a of [0, 1, 2.5, 4, 5.5]) {
      const p = launchPoint(SITE_POS, a);
      expect(p.x).toBe(Math.cos(a) * u(WORLD.spawnDist));
      expect(p.z).toBe(Math.sin(a) * u(WORLD.spawnDist));
    }
  });
  it('is always on the map, and leaves room to fly in, wherever the area is', () => {
    for (const [cx, cz] of [[FAR, 0], [-FAR, 0], [0, FAR], [0, -FAR], [FAR, FAR], [-FAR, FAR], [340, 340], [-340, -340], [120, -80]]) {
      for (let a = 0; a < 2 * Math.PI; a += 0.13) {
        const p = launchPoint({ x: cx, z: cz }, a);
        expect(onMap(p.x, p.z)).toBe(true);
        expect(Math.hypot(p.x - cx, p.z - cz)).toBeGreaterThanOrEqual(u(2000) - 1e-6);
      }
    }
  });
  it('still comes from the bearing asked for when there is room', () => {
    const p = launchPoint({ x: FAR, z: 0 }, Math.PI); // towards the middle of the map, with plenty of room
    expect(p.x).toBeCloseTo(FAR - u(WORLD.spawnDist));
  });
});

describe('with an area drawn', () => {
  beforeEach(() => { sim.commands.setZone(square(FAR, 0)); });

  it('can be drawn anywhere on the map, and not off it', () => {
    expect(addZonePoint(null, FAR, 100).points).toEqual([[FAR, 100]]);
    expect(addZonePoint(null, 340, -340).points).toEqual([[340, -340]]);
    expect(addZonePoint(null, 400, 0)).toBeNull();
  });
  it('lets you build far from the station, and close to it', () => {
    expect(placeNear('radar', FAR, 0)).toBe(true);
    expect(placeNear('rf', 0, u(BUILD.minDist / 2))).toBe(true);
    expect(sim.commands.place('radar', 400, 0)).toMatch(/off the map/);
  });
  it('sends the attack at the area, from around the area', () => {
    sim.commands.enterSandbox();
    for (let i = 0; i < 12; i++) {
      const d = sim.spawnDrone('fw', (i / 12) * 2 * Math.PI);
      expect(onMap(d.pos.x, d.pos.z)).toBe(true);
      expect(hdist(d.pos, sim.state.zoneCentre)).toBeLessThanOrEqual(u(WORLD.spawnDist) + 1e-6);
    }
    sim.run(6000);
    expect(sim.ledger.leaked.fw).toBeGreaterThan(0);
    expect(sim.drones.length).toBe(0);
  }, 60000);
  it('flies a spotter around the area, even at the edge of the map, and sees it leave', () => {
    sim.commands.setZone(square(340, 340));
    sim.commands.enterSandbox();
    sim.spawnDrone('spotter', 0);
    sim.run(16000);
    expect(sim.ledger.launched.spotter).toBe(1);
    expect(sim.drones.length).toBe(0);
    expect(sim.ledger.escaped.spotter).toBe(1);
  }, 60000);
  it('points the wizard at the area, wherever it is', () => {
    const zone = { points: square(FAR, 0), closed: true };
    const spot = suggestSpot(sim, STRUCTURES.radar, zone);
    expect(Math.hypot(spot.x - FAR, spot.z)).toBeLessThan(u(BUILD.maxDist) + 1);
    expect(spot.why).toContain('your zone');
  });
  it('scores coverage of the area, wherever it is', () => {
    const zone = { points: square(FAR, 0), closed: true };
    expect(zoneShare(sim, 'fw', zone)).toBe(0);
    expect(placeNear('radar', FAR, 0)).toBe(true);
    expect(zoneShare(sim, 'fw', zone)).toBeGreaterThan(0.5);
    expect(inZone(zone.points, FAR, 0)).toBe(true);
  });
});

describe('with nothing drawn', () => {
  it('keeps the station and its build ring, and says how to leave them', () => {
    expect(sim.commands.place('radar', u(100), 0)).toMatch(/Too close to the station/);
    expect(sim.commands.place('radar', u(BUILD.maxDist + 100), 0)).toMatch(/Draw an area/);
    expect(DRONES.fw.alt.length).toBe(2);
  });
  it('goes back to the station when the area is cleared', () => {
    sim.commands.setZone(square(FAR, 0));
    sim.commands.setZone(null);
    expect(sim.state.zoneCentre).toBe(SITE_POS);
    expect(sim.commands.place('radar', FAR, 0)).toMatch(/Outside the build zone/);
  });
});

describe('one reach rule for systems, people and patrols', () => {
  const OFFSETS = [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20], [20, 20], [-20, -20], [40, 0], [0, 40], [-40, 0], [0, -40]];
  const near = (fn, x, z) => OFFSETS.some(([dx, dz]) => !fn(x + dx, z + dz)); // true once the ground allows one of the spots
  // A short loop far from the station that the ground allows: no water, steep ground or buildings on it.
  const farRoute = () => {
    for (let cx = 250; cx <= 320; cx += 10) for (let cz = -120; cz <= 120; cz += 20) if (!routeProblem(square(cx, cz, 10))) return square(cx, cz, 10);
    return null;
  };

  it('lets people stand far from the station once an area is drawn, and not before', () => {
    expect(sim.commands.placePeople(FAR, 0, 5, 'open')).toMatch(/build zone/);
    sim.commands.setZone(square(FAR, 0));
    expect(near((x, z) => sim.commands.placePeople(x, z, 5, 'open'), FAR, 0)).toBe(true);
    expect(sim.commands.placePeople(400, 0, 5, 'open')).toMatch(/off the map/);
  });
  it('lets a patrol walk far from the station, with systems placed beside it', () => {
    const route = farRoute();
    expect(route).not.toBeNull();
    expect(sim.commands.setPatrol(route)).toBeNull();
    expect(sim.siteIsFree()).toBe(true);
    const [[x, z]] = route;
    expect(near((px, pz) => sim.commands.place('rf', px, pz), x, z + 3)).toBe(true); // inside its 200 m corridor
    expect(sim.commands.place('rf', x, z + 30)).toMatch(/inside its corridor/);
    expect(routeProblem(square(345, 0, 10))).toMatch(/off the map/);
  });
  it('will not have an area and a patrol at once, whichever comes first', () => {
    const route = farRoute();
    sim.commands.setPatrol(route);
    expect(sim.commands.setZone(square(FAR, 0))).toMatch(/Clear the patrol first/);
    expect(sim.state.zone).toBeNull();
    sim.commands.setPatrol(null);
    expect(sim.commands.setZone(square(FAR, 0))).toBeNull();
    expect(sim.commands.setPatrol(route)).toMatch(/Clear the area to defend first/);
    expect(sim.getPatrol()).toBeNull();
  });
  it('keeps the station rules with neither', () => {
    expect(sim.siteIsFree()).toBe(false);
    expect(sim.commands.placePeople(u(BUILD.maxDist + 100), 0, 5, 'open')).toMatch(/build zone/);
  });
});
