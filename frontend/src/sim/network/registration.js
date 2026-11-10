// Nodes joining and leaving the network, their status reports, and the fusion node's view of who is reachable.

import * as S from '../sapient.js';
import { FUSION } from '../config/index.js';
import { CONDITIONS, ENV } from '../conditions.js';
import { rand } from '../rng.js';
import { RB_UNITS, rbDatum, dur } from './core.js';

export function createRegistration(core, raiseAlert) {
  const { ctx, mpu, T, nodes, names, comms, routeTo, send, deliver, antennaM } = core;
  const counters = {};

  function capabilities(s) {
    const def = s.def;
    const caps = [];
    if (def.range) caps.push({ category: 'performance', type: 'maximum range', value: String(def.range), units: 'm' });
    if (def.sapient.interval) caps.push({ category: 'performance', type: 'report interval', value: String(def.sapient.interval), units: 's' });
    if (def.ref && def.ref.analogues) caps.push({ category: 'reference', type: 'real-world analogue', value: def.ref.analogues.join(' / ') });
    caps.push({ category: 'configuration', type: 'role', value: def.role }); // the standard needs at least one
    return caps;
  }

  // The commands a node accepts, so a fusion node from another maker would know a camera can be pointed or an effector told to engage.
  // `units` lists the values a command takes; completion_time is how long it takes at most (a camera's half-turn at its slew rate).
  function commands(s, modes) {
    const def = s.def, cmd = (type, units, secs = 0) => ({ units, completion_time: dur(secs), type });
    if (def.fov) return [cmd('COMMAND_TYPE_LOOK_AT', 'location_list', def.slewRate ? S.round(180 / def.slewRate, 1) : 0), cmd('COMMAND_TYPE_MODE_CHANGE', modes.join(', '))];
    if (def.kind === 'jammer') return [cmd('COMMAND_TYPE_MODE_CHANGE', modes.join(', '))];
    if (def.role === 'effector') return [cmd('COMMAND_TYPE_REQUEST', 'Engage')]; // command_parameter carries the track's object_id
    return [];
  }

  // shortcut: region tasks are declared because the standard requires a region definition, but no node acts on one; honour them if the
  // fusion node ever sends regions.
  const taskDefinition = (cmds) => ({
    concurrent_tasks: cmds.length ? 1 : 0,
    region_definition: { region_type: ['REGION_TYPE_AREA_OF_INTEREST'], region_area: [{ location_units: 'LOCATION_COORDINATE_SYSTEM_LAT_LNG_DEG_M', location_datum: 'LOCATION_DATUM_WGS84_E' }] },
    ...(cmds.length ? { command: cmds } : {}),
  });
  const UAV_CLASS = [{ class_definition: [{ type: 'Air Vehicle', sub_class: [{ type: 'UAV', level: 1 }] }] }];
  const ENU = { enu_velocity_units: { east_north_rate_units: 'SPEED_UNITS_MS', up_rate_units: 'SPEED_UNITS_MS' }, location_datum: 'LOCATION_DATUM_WGS84_E' };

  function modeDefinitions(s) {
    const def = s.def, sp = def.sapient;
    if (def.role === 'fusion') {
      return [{
        mode_name: 'Fuse', mode_type: 'MODE_TYPE_DEFAULT', mode_description: 'Track fusion and effector tasking', settle_time: dur(0),
        tracking_type: 'TRACKING_TYPE_TRACK_WITH_RE_ID', task: taskDefinition([]),
        detection_definition: [{ location_type: { location_units: 'LOCATION_COORDINATE_SYSTEM_LAT_LNG_DEG_M', location_datum: 'LOCATION_DATUM_WGS84_E' }, detection_class_definition: UAV_CLASS, velocity_type: ENU }],
      }];
    }
    const modes = sp.modes || [def.role === 'sensor' ? 'Detect' : 'Ready'];
    const task = taskDefinition(commands(s, modes));
    return modes.map((name, i) => ({
      mode_name: name, mode_type: i === 0 ? 'MODE_TYPE_DEFAULT' : 'MODE_TYPE_TEMPORARY', mode_description: `${def.name} ${name.toLowerCase()}`,
      settle_time: dur(0), scan_type: sp.scan, task,
      ...(def.role === 'sensor' ? {
        maximum_latency: dur(sp.interval || 1), tracking_type: 'TRACKING_TYPE_TRACK',
        detection_definition: [{ location_type: { range_bearing_units: RB_UNITS, range_bearing_datum: rbDatum() }, detection_class_definition: UAV_CLASS, ...(sp.velocity ? { velocity_type: ENU } : {}) }],
      } : {}),
    }));
  }

  function registrationBody(s) {
    const def = s.def;
    return {
      node_definition: [{ node_type: def.sapient.nodeType, node_sub_type: def.sapient.subType || [] }],
      icd_version: S.ICD_VERSION,
      name: s.name,
      short_name: s.short,
      capabilities: capabilities(s),
      status_definition: {
        status_interval: dur(FUSION.statusInterval),
        location_definition: { location_units: 'LOCATION_COORDINATE_SYSTEM_LAT_LNG_DEG_M', location_datum: 'LOCATION_DATUM_WGS84_E' },
      },
      mode_definition: modeDefinitions(s),
      config_data: [{ manufacturer: 'Site Guard simulation', model: `${def.name} (class model)`, software_version: 'sim-0.1' }],
    };
  }

  function register(s) {
    S.clock.t = T();
    const dest = routeTo(s);
    send(S.envelope(s.nodeId, 'registration', registrationBody(s)), s.nodeId, dest);
    send(S.envelope(dest, 'registration_ack', { acceptance: true }, s.nodeId), dest, s.nodeId);
    nodes.set(s.nodeId, s);
    s.statusT = 0; s.lastStatusKey = null;
    sendStatus(s, true);
  }

  // A newly built structure joins the network.
  // reserved: callsigns that units still to join have saved, so automatic numbering must not take them.
  function registerNode(s, reserved) {
    const def = s.def;
    const inUse = (short) => reserved?.has(short) || [...nodes.values()].some((n) => n.short === short);
    do {
      counters[def.id] = (counters[def.id] || 0) + 1;
      s.autoShort = `${def.short}-${String(counters[def.id]).padStart(2, '0')}`;
    } while (inUse(s.autoShort));
    s.autoName = `${def.name} ${String(counters[def.id]).padStart(2, '0')}`;
    s.nodeId = S.uuid();
    if (s.custom?.callsign && [...nodes.values()].some((n) => n.short === s.custom.callsign)) s.custom.callsign = ''; // a save cannot make two the same
    nameNode(s);
    s.mode = def.sapient.modes ? def.sapient.modes[0] : def.role === 'sensor' ? 'Detect' : 'Ready';
    s.reportT = rand() * (def.sapient.interval || 1);
    s.objIds = new WeakMap(); // keyed by the drone itself: a removed drone is not kept alive by every sensor that saw it
    if (def.fov) { s.point = { az: rand() * 360, el: 3 }; s.cue = null; s.lookedAt = new Map(); } // a camera has an aim
    s.task = null; s.rejected = new Map(); s.denied = new Set();
    s.uplink = null; s.cellBand = 'B8'; s.offline = false; s.lastHeard = T(); s.modePending = null; // no terminal wired yet
    if (def.bands) s.jamBands = new Set(def.bands);
    register(s);
    return s;
  }

  function nameNode(s) {
    s.name = s.custom?.name || s.autoName;
    s.short = s.custom?.callsign || s.autoShort;
    names.set(s.nodeId, s.name);
  }

  function deregisterNode(s) {
    if (!nodes.has(s.nodeId)) return;
    sendStatus(s, true, 'SYSTEM_GOODBYE');
    nodes.delete(s.nodeId);
  }

  function sendStatus(s, forceNew, system = 'SYSTEM_OK') {
    const key = `${s.mode}|${s.task ? s.task.id : ''}`;
    const info = forceNew || key !== s.lastStatusKey ? 'INFO_NEW' : 'INFO_UNCHANGED';
    s.lastStatusKey = key;
    s.lastStatusT = T();
    const body = {
      report_id: S.ulid(), system, info, mode: s.mode,
      power: { source: 'POWERSOURCE_MAINS', status: 'POWERSTATUS_OK' },
      node_location: S.location(s.pos.x * mpu(), -s.pos.z * mpu(), antennaM(s)),
    };
    if (s.task) body.active_task_id = s.task.id;
    const def = s.def, env = CONDITIONS[ENV.now];
    const status = (type, value) => ({ status_level: 'STATUS_LEVEL_INFORMATION_STATUS', status_type: type, status_value: value });
    body.status = [
      ...(def.lowAlt ? [status('STATUS_TYPE_CLUTTER', `Targets below ${def.lowAlt} m masked beyond ${Math.round(def.lowRange)} m`)] : []), // its clutter range as edited and set
      ...(def.role === 'sensor' ? [status('STATUS_TYPE_ILLUMINATION', env.light), status('STATUS_TYPE_WEATHER', env.weather)] : []), // what it is working in
    ];
    if (!body.status.length) delete body.status;
    const res = send(S.envelope(s.nodeId, 'status_report', body), s.nodeId, routeTo(s));
    deliver(res, () => { if (nodes.has(s.nodeId)) heard(s); }); // only if the report gets through, and not a goodbye from a node now gone
  }

  // The fusion node's view of whether a node is reachable. Three missed status reports in a row means contact is lost.
  function heard(s) {
    s.lastHeard = T();
    if (s.offline) {
      s.offline = false;
      raiseAlert('information', `Contact restored with ${s.name}`, null, 'DISCRETE_PRIORITY_LOW');
    }
  }
  function checkContact() {
    if (!ctx.monitoring || !ctx.monitoring()) return;
    for (const s of nodes.values()) {
      if ((s.def.role !== 'sensor' && s.def.role !== 'effector') || s.def.id === 'perimeter' || s.def.networked === false || s.offline) continue; // a crew off the network is never expected
      if (T() - s.lastHeard > FUSION.statusInterval * 3.2) { // three status reports in a row missed
        s.offline = true;
        const why = comms.pathFor(s);
        raiseAlert('warning', `Lost contact with ${s.name}: ${why.ok ? 'messages are being lost or delayed' : why.reason}`, null, 'DISCRETE_PRIORITY_MEDIUM');
      }
    }
  }

  const reset = () => { for (const k of Object.keys(counters)) delete counters[k]; };

  return { register, registerNode, renameNode: nameNode, deregisterNode, sendStatus, checkContact, reset };
}
