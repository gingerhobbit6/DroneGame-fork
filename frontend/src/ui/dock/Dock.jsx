// The SAPIENT panel: one view at a time, opened by its own button (in the Controls menu, or the Run panel for Plan and Statistics).
// A view with two parts shows a tab for each. Every view stays mounted, so filters and selections survive switching, but only the
// visible part refreshes.

import { useState } from 'react';
import { MessagesTab } from './MessagesTab.jsx';
import { NodesTab } from './NodesTab.jsx';
import { PlanTab, PropagationTab } from './PlanTab.jsx';
import { NetworkTab } from './NetworkTab.jsx';
import { SpectrumTab } from './SpectrumTab.jsx';
import { CostTab } from './CostTab.jsx';
import { SourcesTab } from './SourcesTab.jsx';
import { SavedTab } from './SavedTab.jsx';
import { RunsTab } from './RunsTab.jsx';
import { LabTab } from './LabTab.jsx';
import { RulesTab } from './RulesTab.jsx';
import { StatsTab } from '../RunStats.jsx';
import { TuningFields } from '../Panels.jsx';
import { Movable } from '../Movable.jsx';
import { ICONS, Icon } from '../icons.jsx';
import { CONTROLS, RUN, useBeside } from '../beside.js';

// Your saved laydowns, and below them every past run.
function SavedAndRuns({ active }) {
  return (
    <>
      <SavedTab active={active} />
      <h4 className="dock-section" id="runs-heading">Past runs</h4>
      <RunsTab active={active} />
    </>
  );
}

// The game's own settings, then every figure and where it comes from.
function TuningAndSources({ active }) {
  return (
    <>
      <TuningFields />
      <h4 className="dock-section">Sources</h4>
      <SourcesTab active={active} />
    </>
  );
}

// Each view and its parts: { id (also the name a link can open it by), label, Part, paneId (an element id kept from the old tabs) }.
// `run` views are opened from the Run panel; the rest from the Controls menu.
export const VIEWS = [
  { id: 'plan', label: 'Plan', icon: 'plan', run: true, parts: [{ id: 'plan', label: 'Plan', Part: PlanTab }], hint: 'Top-down map with sensor coverage and tracks' },
  { id: 'stats', label: 'Statistics', icon: 'stats', run: true, parts: [{ id: 'stats', label: 'Statistics', Part: StatsTab }], hint: 'Hit rate, kill ranges, costs and more: overall, per wave, sensor, effector and drone type' },
  { id: 'nodes', label: 'SAPIENT nodes', icon: 'nodes', parts: [{ id: 'nodes', label: 'Nodes', Part: NodesTab }, { id: 'messages', label: 'Messages', Part: MessagesTab }, { id: 'network', label: 'Network', Part: NetworkTab }], hint: 'Every system on the network, the SAPIENT messages between them, and how each is wired' },
  { id: 'em', label: 'EM Spectrum', icon: 'spectrum', parts: [{ id: 'spectrum', label: 'Spectrum', Part: SpectrumTab }, { id: 'propagation', label: 'Propagation', Part: PropagationTab }], hint: 'Where your jamming, links and radars sit in frequency, and how far sensors and jammers reach over the ground' },
  { id: 'engage', label: 'Targeting', icon: 'engage', parts: [{ id: 'rules', label: 'Engagement rules', Part: RulesTab }, { id: 'cost', label: 'Magazine depth', Part: CostTab, paneId: 'cost' }], hint: 'Which weapons may fire at which drones, and the rounds left' },
  { id: 'lab', label: 'The Lab', icon: 'lab', parts: [{ id: 'lab', label: 'Lab', Part: LabTab }, { id: 'systems', label: 'Tuning', Part: TuningAndSources, paneId: 'systems' }], hint: 'Laydowns from the lab search, the game settings, and every figure with its source' },
  { id: 'saved', label: 'Saved', icon: 'saved', parts: [{ id: 'saved', label: 'Saved', Part: SavedAndRuns }], hint: 'Save and load laydowns, and the results of past runs' },
];
const PART_VIEW = Object.fromEntries(VIEWS.flatMap((v) => v.parts.map((p) => [p.id, v.id])));
PART_VIEW.runs = 'saved'; PART_VIEW.coverage = 'em'; // names older links use
// The view a name opens: a view's own name, or one of its parts'.
export const viewOf = (name) => PART_VIEW[name] ?? name;
const partOf = (name) => (VIEWS.some((v) => v.parts.some((p) => p.id === name) && v.parts.length > 1) ? name : null);

// tab: the view (or part) to show; onClose closes it. Opening one view replaces the last, so only one is ever open.
export function Dock({ open, onClose, tab = 'nodes' }) {
  const id = viewOf(tab), view = VIEWS.find((v) => v.id === id) ?? VIEWS[2];
  const [chosen, setChosen] = useState(() => (partOf(tab) ? { [id]: partOf(tab) } : {})); // the part last shown in each two-part view
  const [asked, setAsked] = useState(tab);
  if (asked !== tab) { setAsked(tab); const p = partOf(tab); if (p) setChosen((c) => ({ ...c, [id]: p })); } // a link to a part shows that part
  const [max, setMax] = useState(false);
  const partShown = (v) => chosen[v.id] ?? v.parts[0].id;
  useBeside('dock', view.run ? RUN : CONTROLS, view.run ? 'right' : 'left', [open, view.id, max], { stretch: true, off: max || !open });
  return (
    <Movable id="dock" title={view.label} data-view={view.id} className={`panel${open ? '' : ' hidden'}${max ? ' max' : ''}`}>
      <div className="dock-head">
        {view.parts.length > 1 && (
          <div className="tabs" role="tablist" aria-label={view.label}>
            {view.parts.map((p) => (
              <button key={p.id} data-tab={p.id} role="tab" aria-selected={partShown(view) === p.id} className={partShown(view) === p.id ? 'active' : ''} onClick={() => setChosen((c) => ({ ...c, [view.id]: p.id }))}>{p.label}</button>
            ))}
          </div>
        )}
        <div className="dock-controls">
          <button id="dock-max" title="Make the panel bigger or smaller" aria-label="Make the panel bigger or smaller" onClick={() => setMax((m) => !m)}><Icon path={ICONS.max} size={15} /></button>
          <button id="dock-close" title="Close" aria-label="Close" onClick={onClose}>×</button>
        </div>
      </div>
      {VIEWS.map((v) => (
        <div key={v.id} className={`tabpane${v.id === view.id ? '' : ' hidden'}`} data-pane={v.id}>
          {v.parts.map(({ id: part, Part, paneId }) => {
            const shown = v.id === view.id && partShown(v) === part;
            return <div key={part} id={paneId} data-part={part} className={`dock-part${shown ? '' : ' hidden'}`}><Part active={open && shown} /></div>;
          })}
        </div>
      ))}
    </Movable>
  );
}
