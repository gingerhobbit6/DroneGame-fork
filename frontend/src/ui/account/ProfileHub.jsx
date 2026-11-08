// After signing in: the player's profile, their security settings, and their deployment packs, ready to deploy into the game.

import { useEffect, useState } from 'react';
import { ECHELONS } from '../../sim/config/index.js';
import { money } from '../../sim/economy.js';
import { useArmed } from '../hooks.js';
import { Logo, MIN_PASSWORD, PasswordField, RecoveryCode, TextField, ZuluClock, initials, useRequest } from './parts.jsx';
import { PackEditor } from './PackEditor.jsx';
import { blankPack, describeTotals, packTotals } from './pack.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never');

function ProfileCard({ api, user, onChange }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(user);
  const { busy, error, run } = useRequest();
  const save = (e) => {
    e.preventDefault();
    run(async () => { onChange(await api.auth.updateProfile({ display_name: form.display_name, rank: form.rank, organisation: form.organisation })); setEditing(false); });
  };
  return (
    <section className="acct-box" aria-label="Your profile">
      <h3>Profile{!editing && <button className="acct-ghost" onClick={() => { setForm(user); setEditing(true); }}>Edit</button>}</h3>
      <div className="acct-who">
        <span className="acct-avatar" aria-hidden="true">{initials(user.display_name)}</span>
        <div><b>{user.display_name}</b><span>{[user.rank, user.organisation].filter(Boolean).join(' · ') || `@${user.username}`}</span></div>
      </div>
      {editing ? (
        <form className="acct-form" onSubmit={save}>
          <TextField label="Name" value={form.display_name} onChange={(display_name) => setForm({ ...form, display_name })} required maxLength={60} />
          <TextField label="Rank or role" value={form.rank} onChange={(rank) => setForm({ ...form, rank })} maxLength={60} />
          <TextField label="Unit or organisation" value={form.organisation} onChange={(organisation) => setForm({ ...form, organisation })} maxLength={60} />
          {error && <p className="acct-error" role="alert">{error}</p>}
          <div className="acct-actions"><button className="acct-go" disabled={busy || !form.display_name.trim()}>Save</button><button type="button" className="acct-ghost" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>
      ) : (
        <dl className="acct-facts">
          <dt>Username</dt><dd>{user.username}</dd>
          <dt>Member since</dt><dd>{when(user.created_at)}</dd>
          <dt>Last sign-in</dt><dd>{when(user.last_sign_in)}</dd>
        </dl>
      )}
    </section>
  );
}

function SecurityCard({ api, onSignOut, onDeleted }) {
  const [open, setOpen] = useState(null); // password | code | delete
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [code, setCode] = useState(null);
  const [done, setDone] = useState(null);
  const { busy, error, setError, run } = useRequest();
  const close = () => { setOpen(null); setCurrent(''); setNext(''); setCode(null); setError(null); };
  const change = (e) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD) { setError(`The new password needs at least ${MIN_PASSWORD} characters.`); return; }
    run(async () => { await api.auth.changePassword({ current_password: current, new_password: next }); close(); setDone('Password changed. Every other device was signed out.'); });
  };
  const newCode = (e) => { e.preventDefault(); run(async () => setCode((await api.auth.newRecoveryCode({ password: current })).recovery_code)); };
  const remove = (e) => { e.preventDefault(); run(async () => { await api.auth.deleteAccount({ password: current }); onDeleted(); }); };
  const submit = { password: [change, 'Change password'], code: [newCode, 'Show a new code'], delete: [remove, 'Delete my account'] }[open];
  if (code) return <section className="acct-box"><RecoveryCode code={code} title="Your new recovery code" doneLabel="Done" onDone={() => { close(); setDone('The old recovery code no longer works.'); }}>Save it somewhere safe. The old one no longer works.</RecoveryCode></section>;
  return (
    <section className="acct-box" aria-label="Security">
      <h3>Security</h3>
      {done && <p className="acct-note" role="status">{done}</p>}
      {open ? (
        <form className="acct-form" onSubmit={submit[0]}>
          {open === 'delete' && <p className="acct-error">This deletes your account, your profile and all your deployment packs, and cannot be undone. Shared laydowns and runs stay.</p>}
          <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
          {open === 'password' && <PasswordField label="New password" hint={`At least ${MIN_PASSWORD} characters`} value={next} onChange={setNext} autoComplete="new-password" />}
          {error && <p className="acct-error" role="alert">{error}</p>}
          <div className="acct-actions">
            <button className={open === 'delete' ? 'acct-ghost danger' : 'acct-go'} disabled={busy || !current}>{submit[1]}</button>
            <button type="button" className="acct-ghost" onClick={close}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="acct-actions">
          <button className="acct-ghost" onClick={() => { setDone(null); setOpen('password'); }}>Change password</button>
          <button className="acct-ghost" onClick={() => { setDone(null); setOpen('code'); }}>New recovery code</button>
          <button className="acct-ghost danger" onClick={onSignOut}>Sign out</button>
          <button className="acct-ghost danger" onClick={() => { setDone(null); setOpen('delete'); }}>Delete account</button>
        </div>
      )}
    </section>
  );
}

function PackCard({ pack, active, onDeploy, onEdit, onDelete }) {
  const del = useArmed();
  const totals = packTotals(pack.assets);
  return (
    <article className="acct-pack" data-pack={pack.id}>
      <header><b>{pack.name}</b><span className="acct-badge">{ECHELONS[pack.echelon]?.name ?? pack.echelon}</span></header>
      <span className="acct-muted">{pack.callsign ? `Callsign ${pack.callsign} · ` : ''}{describeTotals(totals)}</span>
      <span className="acct-price">{money(totals.cost)} of systems</span>
      <div className="acct-actions">
        <button className="acct-go" onClick={onDeploy}>{active ? 'Deployed: open the game' : 'Deploy'}</button>
        <button className="acct-ghost" onClick={onEdit}>Edit</button>
        <button className="acct-ghost danger" onClick={del.confirm('delete', onDelete)}>{del.armed ? 'Sure?' : 'Delete'}</button>
      </div>
    </article>
  );
}

function Packs({ api, account, onEnter }) {
  const [packs, setPacks] = useState(null);
  const [editing, setEditing] = useState(() => (account.editActive ? account.activeUnit : null)); // opened from the game's pack tray
  const { error, run } = useRequest();
  // the list holds summaries, so each card's contents are fetched too; a profile has at most 50 packs
  const load = () => run(async () => setPacks(await Promise.all((await api.units.list()).map((p) => api.units.get(p.id)))));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);
  const remove = (id) => run(async () => { await api.units.remove(id); if (account.activeUnit?.id === id) account.deploy(null); await load(); });
  const back = () => { setEditing(null); if (account.editActive) account.doneEditing(); };
  if (editing) return <PackEditor api={api} pack={editing} onCancel={back} onSaved={(saved) => { if (account.activeUnit?.id === saved.id) account.deploy(saved); load(); back(); }} />;
  return (
    <section className="acct-box" aria-label="Deployment packs">
      <h3>Deployment packs<button className="acct-ghost" onClick={() => setEditing(blankPack())}>New pack</button></h3>
      <p className="acct-muted">A pack is a military unit: the real sensors, effectors, vehicles and people assigned to it. Deploy one, and the game lists its kit in a tray beside the toolbar, ready to drag onto the map.</p>
      {error && <p className="acct-error" role="alert">{error}</p>}
      {packs === null ? <p className="acct-muted">Loading your packs</p> : packs.length === 0 ? (
        <div className="acct-empty"><p>No deployment packs yet.</p><button className="acct-go" onClick={() => setEditing(blankPack())}>Build your first pack</button></div>
      ) : (
        <div className="acct-packs">
          {packs.map((p) => <PackCard key={p.id} pack={p} active={account.activeUnit?.id === p.id} onEdit={() => setEditing(p)} onDelete={() => remove(p.id)} onDeploy={() => { account.deploy(p); onEnter(); }} />)}
        </div>
      )}
    </section>
  );
}

export function ProfileHub({ api, account, inGame, onEnter }) {
  const { user } = account;
  return (
    <main className="acct" onKeyDown={(e) => e.stopPropagation()}>
      <div className="acct-sky" aria-hidden="true" />
      <div className="acct-hub">
        <header className="acct-bar">
          <Logo />
          <ZuluClock />
          <button className="acct-go" id="enter-game" onClick={onEnter}>{inGame ? 'Back to the game' : 'Enter the game'}</button>
        </header>
        <h2 className="acct-hello">Welcome, {user.display_name}</h2>
        <p>{account.activeUnit ? `Deployed: ${account.activeUnit.name}. Its kit waits in the pack tray in the game.` : 'Build a deployment pack, or go straight into the game and buy systems one by one.'}</p>
        <div className="acct-grid">
          <div className="acct-side">
            <ProfileCard api={api} user={user} onChange={account.setUser} />
            <SecurityCard api={api} onSignOut={account.signOut} onDeleted={() => account.leave('Your account and its deployment packs were deleted.')} />
          </div>
          <Packs api={api} account={account} onEnter={onEnter} />
        </div>
      </div>
    </main>
  );
}
