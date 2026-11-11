// The player's rules of engagement: a weapon barred from a drone type holds fire on it once a sensor has named it.

import { describe, expect, it } from 'vitest';
import { DRONES } from '../src/sim/config/index.js';
import { UNKNOWN, barsDrone, barsTrack, setRule, valueRules } from '../src/sim/engage-rules.js';

const ids = Object.keys(DRONES);
const quad = ids.find((id) => DRONES[id].airframe === 'Multirotor'), wing = ids.find((id) => DRONES[id].airframe === 'Fixed wing');
const named = (id) => ({ model: DRONES[id].label ?? DRONES[id].name, airframe: DRONES[id].airframe });

describe('rules of engagement', () => {
  it('holds fire on a drone named as a barred type, and on nothing else', () => {
    const rules = setRule({}, 'missile_paladin', quad, false);
    expect(barsTrack(rules, 'missile_paladin', named(quad), [quad, wing])).toBe(true);
    expect(barsTrack(rules, 'missile_paladin', named(wing), [quad, wing])).toBe(false);
    expect(barsTrack(rules, 'gun_hmg', named(quad), [quad, wing])).toBe(false);
  });

  it('judges an airframe alone by every drone of that airframe in the attack', () => {
    const quads = ids.filter((id) => DRONES[id].airframe === 'Multirotor').slice(0, 2);
    const track = { model: null, airframe: 'Multirotor' };
    let rules = setRule({}, 'missile_paladin', quads[0], false);
    expect(barsTrack(rules, 'missile_paladin', track, quads)).toBe(quads.length < 2);
    rules = setRule(rules, 'missile_paladin', quads[1], false);
    expect(barsTrack(rules, 'missile_paladin', track, quads)).toBe(true);
  });

  it('holds fire on an unnamed track only where Unidentified is barred', () => {
    const track = { model: null, airframe: 'Unknown' };
    expect(barsTrack(setRule({}, 'missile_paladin', quad, false), 'missile_paladin', track, [quad])).toBe(false);
    expect(barsTrack(setRule({}, 'missile_paladin', UNKNOWN, false), 'missile_paladin', track, [quad])).toBe(true);
  });

  it('lets a crew see what it is firing at, and allowing a pairing again clears it', () => {
    const rules = setRule({}, 'gun_shotgun', wing, false);
    expect(barsDrone(rules, 'gun_shotgun', wing)).toBe(true);
    expect(setRule(rules, 'gun_shotgun', wing, true)).toEqual({});
  });

  it('bars a weapon from drones cheaper than its shot under the value rule', () => {
    const cheap = ids.reduce((a, b) => (DRONES[a].cost < DRONES[b].cost ? a : b));
    const rules = valueRules(['big', 'small'], [cheap], (e) => (e === 'big' ? DRONES[cheap].cost * 10 : 0));
    expect(rules).toEqual({ big: [cheap] });
  });
});
