// On the start screen, after choosing where to defend: which deployment pack to deploy with, or none, to buy systems on a budget.
// Choosing one deploys it at once, as the profile's Deploy button does.

import { useEffect, useState } from 'react';
import { useGame } from '../hooks.js';
import { describeTotals, fetchPacks, packTotals, useAccount } from './pack.js';

export function PackPicker() {
  const { api } = useGame(), account = useAccount();
  const [result, setResult] = useState({ ownerId: null, packs: null, failed: false });
  const ownerId = account?.user?.id, covered = !!account?.covered;
  useEffect(() => {
    if (!ownerId || covered) return undefined; // fetched again whenever the profile closes: packs may have been built or deleted there
    let live = true;
    setResult({ ownerId, packs: null, failed: false });
    fetchPacks(api).then(
      (packs) => { if (live) setResult({ ownerId, packs, failed: false }); },
      () => { if (live) setResult({ ownerId, packs: null, failed: true }); },
    );
    return () => { live = false; };
  }, [api, ownerId, covered]);
  if (!ownerId) return null;
  const { packs, failed } = result.ownerId === ownerId && !covered ? result : { packs: null, failed: false };
  const active = account.activeUnit;
  const choose = (id) => { if (packs) account.deploy(packs.find((p) => String(p.id) === id) ?? null); };
  return (
    <div className="start-pack" id="start-pack">
      <label htmlFor="start-pack-select"><b>Deployment pack</b></label>
      {failed ? <p className="muted">Your packs cannot load just now. You can still deploy one from your profile.</p>
        : packs === null ? <p className="muted">Loading your packs</p>
          : (
            <>
              <select id="start-pack-select" value={active ? String(active.id) : ''} onChange={(e) => choose(e.target.value)}>
                <option value="">None: buy any system, on a budget</option>
                {packs.map((p) => <option key={p.id} value={String(p.id)}>{p.callsign ? `${p.callsign}: ` : ''}{p.name} ({describeTotals(packTotals(p.assets))})</option>)}
              </select>
              <p className="muted">
                {active ? 'Only this pack\'s kit can be placed, and the budget only counts the cost.' : packs.length ? 'With a pack, you place only its kit, and the cost shows in the report at the end.' : 'You have no packs yet.'}
                {' '}<button type="button" className="quiet" id="start-pack-build" onClick={account.openProfile}>{packs.length ? 'Build or edit packs' : 'Build a pack'}</button>
              </p>
            </>
          )}
    </div>
  );
}
