// The SAPIENT panel. Every tab stays mounted, so filters and selections survive switching, but only the visible one refreshes.

import { useState } from 'react';
import { MessagesTab } from './MessagesTab.jsx';
import { NodesTab } from './NodesTab.jsx';
import { PlanTab } from './PlanTab.jsx';
import { NetworkTab } from './NetworkTab.jsx';
import { SpectrumTab } from './SpectrumTab.jsx';
import { LearnTab } from './LearnTab.jsx';
import { CostTab } from './CostTab.jsx';
import { SourcesTab } from './SourcesTab.jsx';
import { SavedTab } from './SavedTab.jsx';
import { RunsTab } from './RunsTab.jsx';
import { LabTab } from './LabTab.jsx';
import { StatsTab } from '../RunStats.jsx';
import { Movable } from '../Movable.jsx';

// Grouped by what the player is trying to do. Every tab stays one click away, with nothing to expand first.
const GROUPS = [
  ['Live', [
    { id: 'stats', label: 'Statistics', Tab: StatsTab, hint: 'Hit rate, kill ranges, costs and more: overall, per wave, sensor, effector and drone type' },
    { id: 'nodes', label: 'Nodes', Tab: NodesTab, hint: 'Every system on the network: what it is doing, its task and its traffic' },
    { id: 'messages', label: 'Messages', Tab: MessagesTab, hint: 'The raw SAPIENT message log, with filters and JSON' },
  ]],
  ['Comms', [
    { id: 'network', label: 'Network', Tab: NetworkTab, hint: 'Wire each system to Starlink or cellular, and watch the packets' },
    { id: 'spectrum', label: 'Spectrum', Tab: SpectrumTab, hint: 'Where your jamming, links and radars sit in frequency' },
  ]],
  ['Plan and cost', [
    { id: 'plan', label: 'Plan', Tab: PlanTab, hint: 'Top-down map with sensor coverage and tracks' },
    { id: 'cost', label: 'Magazine depth', Tab: CostTab, paneId: 'cost', hint: 'Rounds left, budget, cost exchange and shots fired' },
  ]],
  ['Records', [
    { id: 'saved', label: 'Saved', Tab: SavedTab, hint: 'Save and load laydowns' },
    { id: 'runs', label: 'Runs', Tab: RunsTab, hint: 'Results of past runs' },
    { id: 'lab', label: 'Lab', Tab: LabTab, hint: 'Laydowns found by the overnight lab search, with how well each held out' },
  ]],
  ['Reference', [
    { id: 'systems', label: 'Sources', Tab: SourcesTab, paneId: 'systems', hint: 'Every figure and where it comes from. You can edit them here' },
    { id: 'learn', label: 'Learn', Tab: LearnTab, hint: 'How SAPIENT works, step by step, using this run' },
  ]],
];
const TABS = GROUPS.flatMap(([, tabs]) => tabs);

// tab and onTab let the wizard open a tab. Without them the dock keeps its own.
export function Dock({ open, onClose, tab: shown, onTab }) {
  const [own, setOwn] = useState('nodes');
  const tab = shown ?? own, setTab = onTab ?? setOwn;
  const [max, setMax] = useState(false);
  return (
    <Movable id="dock" title="SAPIENT" className={`panel${open ? '' : ' hidden'}${max ? ' max' : ''}`}>
      <div className="dock-head">
        <div className="tabs">
          {GROUPS.map(([name, tabs]) => (
            <div key={name} role="group" aria-label={name}>
              <div className="label" aria-hidden="true">{name}</div>
              {tabs.map(({ id, label, hint }) => <button key={id} data-tab={id} title={hint} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
            </div>
          ))}
        </div>
        <div className="dock-controls">
          <button id="dock-max" title="Make the panel bigger or smaller" onClick={() => setMax((m) => !m)}>⤢</button>
          <button id="dock-close" title="Close" onClick={onClose}>×</button>
        </div>
      </div>
      {TABS.map(({ id, Tab, paneId }) => (
        <div key={id} id={paneId} className={`tabpane${tab === id ? '' : ' hidden'}`} data-pane={id}>
          <Tab active={open && tab === id} />
        </div>
      ))}
    </Movable>
  );
}
