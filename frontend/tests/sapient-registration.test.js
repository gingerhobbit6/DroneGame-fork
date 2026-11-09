import { describe, expect, it } from 'vitest';
import { createSimulation } from '../src/sim/simulation.js';
import { STRUCTURES } from '../src/sim/config/systems.js';
import { bus } from '../src/sim/sapient.js';
import { setUp } from './support/scenarios.js';

// Every system in the catalogue joins the network with a registration the middleware accepts, declaring the commands it takes.
describe('registrations', () => {
  it('are accepted for every system, and declare what each can be told to do', () => {
    const sim = createSimulation();
    const ids = Object.keys(STRUCTURES);
    setUp(sim, { seed: '1', laydown: ids.map((id, i) => [id, Math.cos(i) * (300 + 20 * i), Math.sin(i) * (300 + 20 * i)]) });
    const regs = bus.entries.filter((e) => e.type === 'registration');
    expect(regs.length).toBeGreaterThan(ids.length); // the fusion node and the perimeter as well
    expect(regs.filter((e) => !e.ok).map((e) => e.msg.registration.name)).toEqual([]);
    expect(bus.counts.error ?? 0).toBe(0);
    const cmds = (s) => regs.find((e) => e.msg.node_id === s.nodeId).msg.registration.mode_definition[0].task.command?.map((c) => c.type) ?? [];
    const camera = sim.structures.find((s) => s.def.fov), gun = sim.structures.find((s) => s.def.role === 'effector' && s.def.kind !== 'jammer');
    expect(cmds(camera)).toContain('COMMAND_TYPE_LOOK_AT');
    expect(cmds(gun)).toEqual(['COMMAND_TYPE_REQUEST']);
    expect(cmds(sim.structures.find((s) => s.def.kind === 'jammer'))).toEqual(['COMMAND_TYPE_MODE_CHANGE']);
  });
});
