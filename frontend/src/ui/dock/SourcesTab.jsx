// Every researched figure, tuneable. Each system and enemy drone shows the figures that came from research (or are labelled
// assumptions or game rules), with the evidence beside them. Editing a number changes the game straight away; the arrow
// resets it to the researched value. "Export" saves just your changes as JSON so an experiment can be repeated.

import { memo, useRef, useState } from 'react';
import { COMMS, DRONES, FIGURE_FIELDS, PATROL, PEOPLE, RESEARCHED, STRUCTURES, THREAT_GROUPS, WAVES, WORLD, exportFigures } from '../../sim/config/index.js';
import { download, hex, useGame } from '../hooks.js';
import { NumberInput } from '../NumberInput.jsx';
import { SourceLinks } from './SourceLinks.jsx';
import { FigureSets } from './FigureSets.jsx';

const BASIS_LABEL = { research: 'published', price: 'price', assumption: 'ASSUMPTION', rule: 'game rule' };
const isAssumption = (text) => /ASSUMPTION/i.test(text || '');

export function basisOf(kind, def, key) {
  const meta = FIGURE_FIELDS[key];
  if (kind === 'structures') {
    if (key === 'published') return isAssumption(def.ref.confidence) ? 'assumption' : 'research';
    if (key === 'cost' || key === 'shotCost') return isAssumption(def.ref.cost.confidence) ? 'assumption' : 'price';
    if (key === 'missileSpeed') return 'research';
  } else if (kind === 'comms') {
    if (key === 'cost') return 'price';
    return isAssumption(def.confidence) ? 'assumption' : meta.basis;
  } else if (key === 'cost') return isAssumption(def.costRef.confidence) ? 'assumption' : 'price';
  return meta.basis;
}

function Figures({ kind, id, def, onChange }) {
  const { commands } = useGame();
  return (
    <div className="figs">
      {Object.keys(RESEARCHED[kind][id]).map((key) => {
        const meta = FIGURE_FIELDS[key], basis = basisOf(kind, def, key), base = RESEARCHED[kind][id][key];
        return (
          <label className={`fig ${basis}`} key={key}>
            <span className="fl">{meta.label}</span>
            <NumberInput data-key={key} value={def[key]} step={meta.step} onCommit={(v) => { commands.setFigure(kind, id, key, v); onChange(); }} />
            <span className="fu">{meta.unit}</span>
            <span className={`fb ${basis}`}>{BASIS_LABEL[basis]}</span>
            <button className={`fr${def[key] === base ? ' hidden' : ''}`} title={`Reset to ${base}`} onClick={(e) => { e.preventDefault(); commands.resetFigure(kind, id, key); onChange(); }}>↺</button>
          </label>
        );
      })}
    </div>
  );
}

const Row = ({ k, children }) => <div><span className="k">{k}</span> {children}</div>;
const Conf = ({ text }) => <span className={`conf${isAssumption(text) ? ' assume' : ''}`}>{text}</span>;

// Memoised: it builds about 750 inputs, and the dock re-renders every tab on each click. It redraws itself after its own edits.
export const SourcesTab = memo(function SourcesTab({ active }) {
  const game = useGame();
  const { commands } = game;
  const [, setVersion] = useState(0);
  const changed = () => { setVersion((n) => n + 1); game.figuresChanged(); };
  const file = useRef(null);
  const importFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { commands.importFigures(JSON.parse(await f.text())); changed(); } catch { game.toast('That file is not a valid figures export.'); }
    e.target.value = '';
  };
  return (
    <>
      <div className="sys note">
        Every number here can be changed and takes effect at once. <b>published</b> and <b>price</b> figures come from the sources shown (mostly vendor claims; check them before relying on them), <b>ASSUMPTION</b> had no verified figure, <b>game rule</b> is a balance setting. Message formats follow <a href="https://github.com/dstl/SAPIENT-Proto-Files" target="_blank" rel="noopener noreferrer">BSI Flex 335 v2.0</a>.
        <div className="src-tools">
          <label>Range scale <NumberInput id="src-rangescale" value={WORLD.rangeScale} step={0.1} min={0.1} onCommit={(v) => { if (v > 0) { commands.setRangeScale(v); changed(); } }} /> x published</label>
          <label>First-person-view drone gap <NumberInput id="src-fpvgap" value={WAVES.fpvGap} step={1} min={1} onCommit={(v) => { if (v > 0) commands.setFpvGap(v); }} /> s</label>
          <button id="src-reset" onClick={() => { commands.resetAllFigures(); changed(); }}>Reset all</button>
          <button id="src-export" onClick={() => download('site-guard-figures.json', JSON.stringify(exportFigures(), null, 2), 'application/json')}>Export changes</button>
          <button id="src-import" onClick={() => file.current.click()}>Import</button>
          <input type="file" id="src-file" ref={file} accept="application/json" hidden onChange={importFile} />
        </div>
      </div>
      <FigureSets active={active} onApplied={changed} />
      <h4 className="src-h">Defences</h4>
      {Object.values(STRUCTURES).map((d) => (
        <div className="sys" key={d.id}>
          <div className="sys-h"><i style={{ background: hex(d.color) }} /><b>{d.name}</b> <span className="muted">{d.sapient.nodeType.replace('NODE_TYPE_', '')} · game range {d.range} m</span></div>
          <Figures kind="structures" id={d.id} def={d} onChange={changed} />
          <Row k="Real class">{d.ref.class}</Row>
          <Row k="Modelled on">{d.ref.analogues.join(', ')}</Row>
          <Row k="Published">{d.ref.published}</Row>
          <Row k="Game basis">{d.ref.basis}</Row>
          <Row k="Confidence"><Conf text={d.ref.confidence} /></Row>
          <Row k="Sources"><SourceLinks sources={d.ref.sources} /></Row>
          <Row k="Price">{d.ref.cost.capex} <Conf text={d.ref.cost.confidence} /></Row>
          <Row k="Price sources"><SourceLinks sources={d.ref.cost.sources} /></Row>
        </div>
      ))}
      <h4 className="src-h">Network</h4>
      {['starlink', 'cellular'].map((id) => {
        const d = COMMS[id];
        return (
          <div className="sys" key={id}>
            <div className="sys-h"><b>{d.name}</b> <span className="muted">network terminal · signature {d.signature} to an enemy seeking emitters</span></div>
            <Figures kind="comms" id={id} def={d} onChange={changed} />
            <Row k="Basis">{d.note} <Conf text={d.confidence} /></Row>
            <Row k="Sources"><SourceLinks sources={d.sources} /></Row>
          </div>
        );
      })}
      <h4 className="src-h">Simulated people</h4>
      <div className="sys note"><span className="conf assume">ASSUMPTION</span> Every casualty figure is a round number chosen to show the idea, including each drone's casualty radius below. None of them is real casualty or weapons-effects data, so do not base real decisions on them.</div>
      {Object.entries(PEOPLE).map(([id, d]) => (
        <div className="sys" key={id}>
          <div className="sys-h"><i style={{ background: hex(d.color) }} /><b>{d.name}</b> <span className="muted">{d.desc}</span></div>
          <Figures kind="people" id={id} def={d} onChange={changed} />
        </div>
      ))}
      <h4 className="src-h">Patrol</h4>
      <div className="sys note"><span className="conf assume">ASSUMPTION</span> The patrol's speed, size and spacing are round numbers chosen to show the idea, not any real unit's drills. The escort is assumed to sense and talk on the move, and to stop to fire.</div>
      {Object.entries(PATROL).map(([id, d]) => (
        <div className="sys" key={id}>
          <div className="sys-h"><b>{d.name}</b> <span className="muted">{d.desc}</span></div>
          <Figures kind="patrol" id={id} def={d} onChange={changed} />
        </div>
      ))}
      <h4 className="src-h">Enemy drones</h4>
      {THREAT_GROUPS.map((group, i) => (
        <details key={group.name} open={i === 0}>
          <summary>{group.name} ({group.drones.length})</summary>
          {group.drones.map((d) => (
            <div className="sys" key={d.id}>
              <div className="sys-h"><i style={{ background: hex(d.color) }} /><b>{d.name}</b> <span className="muted">enemy drone · {d.airframe}{d.rfEmitter ? ' · has a radio link' : ' · no radio link'}</span></div>
              <Figures kind="drones" id={d.id} def={d} onChange={changed} />
              {d.published && <Row k="Public figures">{d.published}</Row>}
              {d.usedBy && <Row k="Used by">{d.usedBy}</Row>}
              {d.assumed && <Row k="Assumed">{d.assumed}</Row>}
              <Row k="Cost basis">{d.costRef.note} <Conf text={d.costRef.confidence} /></Row>
              <Row k="Sources"><SourceLinks sources={d.costRef.sources} /></Row>
              <div className="muted">{d.variantOf
                ? `Speed, height and size come from the public figures above. Damage is a game rule worked out from the warhead. Radar cross-section, link power, evasion, health and jam resistance are not public, so they are assumed or carried over from the ${DRONES[d.variantOf].name}.`
                : 'Radar cross-section, size, link power and speed are rough class values I chose, not measurements. Tune them to test how sensitive a laydown is.'}</div>
            </div>
          ))}
        </details>
      ))}
    </>
  );
});
