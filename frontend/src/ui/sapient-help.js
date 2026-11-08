// Plain-English explanations of SAPIENT (BSI Flex 335 v2.0) fields and values, for the Learn tab and the "Explain" view
// of the message inspector. The field and value names are the ones in the standard; the wording is mine.

const FIELD_HELP = {
  timestamp: 'When the message was sent, in game time.',
  node_id: 'Who sent it: the unique ID of the sending node.',
  destination_id: 'Who it is for. Only set when a message is aimed at one node (a task, or an acknowledgement to it).',
  registration: 'A node joining the network and describing itself.',
  registration_ack: 'The network accepting (or refusing) a registration.',
  status_report: 'A heartbeat: "I am alive, in this mode, here".',
  detection_report: 'Something a sensor saw, or something the fusion node has tracked.',
  task: 'An instruction to a node.',
  task_ack: 'The node answering a task: accepted, rejected, completed or failed.',
  alert: 'Something a person or system should know about, or decide.',
  alert_ack: 'The answer to an alert.',
  error: 'The middleware refusing a message that broke the rules.',
  node_definition: 'What kind of node this is.', node_type: 'The category of node (radar, camera, jammer, fusion...).',
  node_sub_type: 'Free-text detail about the node type.', icd_version: 'Which version of the standard the node speaks.',
  name: 'A human-readable name.', short_name: 'A short label.',
  capabilities: 'Facts about what the node can do (range, report rate...).',
  status_definition: 'How often it will send status reports, and what they contain.',
  status_interval: 'The gap between status reports.',
  mode_definition: 'The modes the node can be put in (for example Search and Track).',
  mode_name: 'The name of a mode.', mode_type: 'Whether the mode is the default or a temporary one.',
  scan_type: 'Fixed, scanning or steerable sensor.', tracking_type: 'Whether the node keeps tracks itself.',
  detection_definition: 'What a sensor reports and in what form.', config_data: 'Who made it, which model, which software.',
  report_id: 'A unique ID for this one report.',
  object_id: 'The ID this node gave to the thing it is reporting. Each node numbers things its own way; the fusion node reconciles them.',
  range_bearing: 'Where the thing is, relative to the sensor: how far away and in which direction.',
  azimuth: 'Compass direction from the sensor, in degrees clockwise from north.',
  elevation: 'Angle above the horizon, in degrees.',
  range: 'Distance from the sensor, in metres. Missing for sensors that cannot measure it (a camera or RF direction finder).',
  azimuth_error: 'How uncertain the azimuth is (degrees).', elevation_error: 'How uncertain the elevation is (degrees).',
  range_error: 'How uncertain the range is (metres).',
  coordinate_system: 'The units and frame the numbers are in.', datum: 'The reference the angles are measured from (true north on generated ground, grid north on a real map).',
  detection_confidence: 'How sure the sensor is that this is a real detection (0 to 1).',
  classification: 'What the sensor thinks it is, as a family tree (Air Vehicle, then UAV, then Multirotor or Fixed wing).',
  confidence: 'How sure that classification is (0 to 1).', sub_class: 'A more specific class inside the one above.', level: 'How deep in the family tree this class is.',
  behaviour: 'What it seems to be doing (approaching, loitering).',
  signal: 'A measured radio signal (an RF detector reports these).', amplitude: 'Signal strength in dB.', centre_frequency: 'The signal frequency in Hz.',
  enu_velocity: 'Velocity: east, north and up, in metres per second.',
  location: 'A position on the Earth: x is longitude, y is latitude, z is height in metres.',
  x: 'Longitude.', y: 'Latitude.', z: 'Height above the station base, in metres.',
  derived_detection: 'Which sensor reports this fused report was built from. This is how you can trace a track back to its sensors.',
  state: 'The status of the track (tentative, confirmed or coasting).',
  task_id: 'A unique ID for this task, used to match the acknowledgement.', task_name: 'A short name for the task.',
  task_description: 'What the task is for.', task_start_time: 'When the task should start.',
  control: 'START, STOP or PAUSE the task.', command: 'What to do.',
  request: 'A free-text request. Here "Engage" tells an effector to engage a track (the standard does not define an engage command).',
  command_parameter: 'The detail of the request: for Engage, the track to engage.',
  mode_change: 'Switch the node to another of its modes.',
  look_at: 'Point a sensor at a location.', location_list: 'A list of locations.', locations: 'The locations themselves.',
  task_status: 'The node\'s answer to the task.', reason: 'Why: the explanation for a rejection, completion or failure.',
  alert_id: 'A unique ID for this alert.', alert_type: 'How serious: information, warning, critical...',
  description: 'What the alert says.', priority: 'How urgent: low, medium or high.', ranking: 'How important relative to other alerts (0 to 1).',
  alert_ack_status: 'The answer to the alert.',
  acceptance: 'Whether the registration was accepted.',
  error_message: 'What was wrong with the message.', packet: 'The offending message, truncated.',
  power: 'Where the node gets power.', node_location: 'Where the node is.', active_task_id: 'The task the node is working on now.',
  system: 'Overall health of the node.', info: 'Whether anything changed since the last status report.', mode: 'The mode the node is in.',
  status_level: 'How serious the status item is.', status_type: 'What kind of status item.', status_value: 'The detail.',
};

const ENUM_HELP = {
  TASK_STATUS_ACCEPTED: 'the node agreed to do it', TASK_STATUS_REJECTED: 'the node refused', TASK_STATUS_COMPLETED: 'the node finished it', TASK_STATUS_FAILED: 'the node could not do it',
  CONTROL_START: 'begin', CONTROL_STOP: 'stop', ALERT_ACK_STATUS_ACCEPTED: 'a person or system said yes', ALERT_ACK_STATUS_REJECTED: 'the answer was no', ALERT_ACK_STATUS_CANCELLED: 'it lapsed before anyone answered',
  ALERT_TYPE_INFORMATION: 'for your information', ALERT_TYPE_WARNING: 'needs attention', ALERT_TYPE_CRITICAL: 'urgent',
  SYSTEM_OK: 'working normally', SYSTEM_GOODBYE: 'leaving the network', INFO_NEW: 'something changed', INFO_UNCHANGED: 'no change since last time',
  NODE_TYPE_RADAR: 'a radar', NODE_TYPE_CAMERA: 'a camera', NODE_TYPE_PASSIVE_RF: 'a passive radio sensor', NODE_TYPE_JAMMER: 'a jammer', NODE_TYPE_KINETIC: 'a physical interceptor',
  NODE_TYPE_LDEW: 'a laser', NODE_TYPE_ACOUSTIC: 'an acoustic sensor', NODE_TYPE_FUSION_NODE: 'the fusion node', NODE_TYPE_PROXIMITY_SENSOR: 'a close-range sensor',
  MODE_TYPE_DEFAULT: 'the mode it starts in', MODE_TYPE_TEMPORARY: 'a mode it can be switched into',
  DISCRETE_PRIORITY_HIGH: 'high', DISCRETE_PRIORITY_MEDIUM: 'medium', DISCRETE_PRIORITY_LOW: 'low',
  RANGE_BEARING_COORDINATE_SYSTEM_DEGREES_M: 'angles in degrees, range in metres', RANGE_BEARING_DATUM_TRUE: 'measured from true north', RANGE_BEARING_DATUM_GRID: 'measured from grid north',
  LOCATION_COORDINATE_SYSTEM_LAT_LNG_DEG_M: 'latitude and longitude in degrees, height in metres', LOCATION_DATUM_WGS84_E: 'the standard GPS reference',
  POWERSOURCE_MAINS: 'mains power', STATUS_TYPE_CLUTTER: 'ground clutter is affecting it', STATUS_TYPE_ILLUMINATION: 'the light it is working in', STATUS_TYPE_WEATHER: 'the weather it is working in',
};

// JSON with a plain-English comment after each known field. Returns an array of lines.
export function annotate(value, indent = 0, key = null, out = []) {
  const pad = '  '.repeat(indent);
  const note = (k, v) => {
    const help = k && FIELD_HELP[k] && (typeof v === 'object' || indent <= 6) ? FIELD_HELP[k] : '';
    const en = typeof v === 'string' && ENUM_HELP[v] ? ` = ${ENUM_HELP[v]}` : '';
    return help || en ? `  // ${help}${en}` : '';
  };
  const label = key !== null ? `"${key}": ` : '';
  if (Array.isArray(value)) {
    if (!value.length) out.push(`${pad}${label}[]${note(key, value)}`);
    else if (value.every((x) => typeof x !== 'object')) out.push(`${pad}${label}${JSON.stringify(value)}${note(key, value)}`);
    else { out.push(`${pad}${label}[${note(key, value)}`); value.forEach((x) => annotate(x, indent + 1, null, out)); out.push(`${pad}]`); }
  } else if (value && typeof value === 'object') {
    out.push(`${pad}${label}{${note(key, value)}`);
    for (const [k, v] of Object.entries(value)) annotate(v, indent + 1, k, out);
    out.push(`${pad}}`);
  } else {
    out.push(`${pad}${label}${JSON.stringify(value)}${note(key, value)}`);
  }
  return out;
}
