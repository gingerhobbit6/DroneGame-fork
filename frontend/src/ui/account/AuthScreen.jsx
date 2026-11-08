// The login page: sign in, create an account, and reset a forgotten password with the recovery code shown at sign-up.
// There is no email (the game works offline), so the recovery code is the only way back in without the password.

import { useEffect, useState } from 'react';
import { DRONES, STRUCTURES } from '../../sim/config/index.js';
import { ICD_VERSION } from '../../sim/sapient.js';
import { Logo, MIN_PASSWORD, Meter, PasswordField, RecoveryCode, TextField, USERNAME, ZuluClock, passwordStrength, useRequest } from './parts.jsx';

const BLIPS = [[62, 30, ''], [78, 58, 'hostile'], [40, 66, ''], [70, 80, 'hostile'], [30, 38, '']];
const STATS = [[Object.keys(STRUCTURES).length, 'real systems'], [Object.keys(DRONES).length, 'drone threats'], ['SAPIENT', ICD_VERSION]];

function Backdrop() {
  return (
    <div className="acct-sky" aria-hidden="true">
      <div className="acct-radar">
        {BLIPS.map(([x, y, kind], i) => <span key={i} className={`acct-blip ${kind}`} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 1.2}s` }} />)}
      </div>
    </div>
  );
}

function ServerStatus({ api }) {
  const [online, setOnline] = useState(null);
  useEffect(() => { api.auth.health().then(() => setOnline(true), () => setOnline(false)); }, [api]);
  return (
    <div className="acct-status">
      <span><i className={`acct-dot ${online === null ? '' : online ? 'on' : 'off'}`} />{online === null ? 'Checking the server' : online ? 'Server online' : 'Server offline: start it with uv run python -m app'}</span>
      <span>Accounts and packs stay on this computer</span>
      <ZuluClock />
    </div>
  );
}

function SignIn({ api, onSignedIn, onForgot, notice }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const { busy, error, run } = useRequest();
  const submit = (e) => {
    e.preventDefault();
    run(async () => onSignedIn(await api.auth.signIn({ username: username.trim(), password, remember })));
  };
  return (
    <form className="acct-form" onSubmit={submit} aria-label="Sign in">
      {notice && <p className="acct-note" role="status">{notice}</p>}
      <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" required maxLength={32} autoFocus />
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <div className="acct-row">
        <label className="acct-check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Keep me signed in for 30 days</label>
        <button type="button" className="acct-link" onClick={onForgot}>Forgotten password?</button>
      </div>
      {error && <p className="acct-error" role="alert">{error}</p>}
      <button className={`acct-go${busy ? ' busy' : ''}`} disabled={busy || !username.trim() || !password}>{busy ? 'Signing in' : 'Sign in'}</button>
    </form>
  );
}

// The new password twice, with the meter. Returns the fields and why the form cannot be sent yet, if it cannot.
function useNewPassword(username) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const problem = password.length < MIN_PASSWORD ? `The password needs at least ${MIN_PASSWORD} characters.`
    : username && password.toLowerCase() === username.toLowerCase() ? 'The password must not be your username.'
      : password !== confirm ? 'The two passwords do not match.' : null;
  const fields = (
    <>
      <PasswordField label="New password" hint={`At least ${MIN_PASSWORD} characters. A short sentence works well.`} value={password} onChange={setPassword} autoComplete="new-password">
        <Meter password={password} username={username} />
      </PasswordField>
      <PasswordField label="Type it again" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={confirm.length > 0 && confirm !== password} />
    </>
  );
  return { password, problem, fields, weak: passwordStrength(password, username).score < 2 };
}

function Register({ api, onRegistered }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const pw = useNewPassword(username);
  const { busy, error, setError, run } = useRequest();
  const badName = username.length > 0 && !USERNAME.test(username.trim());
  const submit = (e) => {
    e.preventDefault();
    if (badName) { setError('Usernames are 3 to 32 letters, digits, dots, dashes or underscores, starting with a letter or digit.'); return; }
    if (pw.problem) { setError(pw.problem); return; }
    run(async () => onRegistered(await api.auth.register({ username: username.trim(), display_name: name.trim(), password: pw.password })));
  };
  return (
    <form className="acct-form" onSubmit={submit} aria-label="Create an account">
      <TextField label="Your name" hint="As it shows on your profile, such as Sgt A. Smith" value={name} onChange={setName} autoComplete="name" required maxLength={60} autoFocus />
      <TextField label="Username" hint="What you sign in with" value={username} onChange={setUsername} autoComplete="username" required maxLength={32} aria-invalid={badName || undefined} />
      {pw.fields}
      {error && <p className="acct-error" role="alert">{error}</p>}
      <button className={`acct-go${busy ? ' busy' : ''}`} disabled={busy || !name.trim() || !username.trim()}>{busy ? 'Creating your account' : 'Create account'}</button>
      <p className="acct-foot">You get a recovery code next. It is the only way to reset a forgotten password.</p>
    </form>
  );
}

function Reset({ api, onReset, onBack }) {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const pw = useNewPassword(username);
  const { busy, error, setError, run } = useRequest();
  const submit = (e) => {
    e.preventDefault();
    if (pw.problem) { setError(pw.problem); return; }
    run(async () => onReset((await api.auth.reset({ username: username.trim(), recovery_code: code, new_password: pw.password })).recovery_code));
  };
  return (
    <form className="acct-form" onSubmit={submit} aria-label="Reset your password">
      <h2>Reset your password</h2>
      <p className="acct-sub">Use the recovery code you saved when you created your account. Lost it too? Whoever runs this server can create you a new account.</p>
      <TextField label="Username" value={username} onChange={setUsername} autoComplete="username" required maxLength={32} autoFocus />
      <TextField label="Recovery code" hint="Six groups of letters and digits. Dashes and capitals do not matter." value={code} onChange={setCode} autoComplete="one-time-code" required maxLength={64} />
      {pw.fields}
      {error && <p className="acct-error" role="alert">{error}</p>}
      <button className={`acct-go${busy ? ' busy' : ''}`} disabled={busy || !username.trim() || !code.trim()}>{busy ? 'Checking' : 'Reset password'}</button>
      <button type="button" className="acct-link" onClick={onBack}>Back to sign in</button>
    </form>
  );
}

export function AuthScreen({ api, onSignedIn, notice: said = null }) {
  const [mode, setMode] = useState('signin'); // signin | register | reset | registered | reset-done
  const [code, setCode] = useState(null);
  const [user, setUser] = useState(null);
  const [notice, setNotice] = useState(said);
  const tabs = mode === 'signin' || mode === 'register';
  let body;
  if (mode === 'registered') {
    body = <RecoveryCode code={code} title="Save your recovery code" doneLabel="Continue to your profile" onDone={() => onSignedIn(user)}>
      If you forget your password, this code lets you set a new one. It is shown only now, and only its scrambled form is kept on the server.
    </RecoveryCode>;
  } else if (mode === 'reset-done') {
    body = <RecoveryCode code={code} title="Password changed" doneLabel="Sign in" onDone={() => { setNotice('Sign in with your new password.'); setMode('signin'); }}>
      Your old recovery code no longer works, and every device was signed out. This is your new code: save it the same way.
    </RecoveryCode>;
  } else if (mode === 'reset') {
    body = <Reset api={api} onBack={() => setMode('signin')} onReset={(next) => { setCode(next); setMode('reset-done'); }} />;
  } else if (mode === 'register') {
    body = <Register api={api} onRegistered={(made) => { setUser(made.user); setCode(made.recovery_code); setMode('registered'); }} />;
  } else {
    body = <SignIn api={api} onSignedIn={onSignedIn} notice={notice} onForgot={() => { setNotice(null); setMode('reset'); }} />;
  }
  return (
    <main className="acct" onKeyDown={(e) => e.stopPropagation()}>
      <Backdrop />
      <div className="acct-login">
        <section className="acct-brand">
          <Logo />
          <p className="acct-tag">Counter-UAS defence simulator</p>
          <p className="acct-pitch">Plan a site&apos;s air defence with real sensors and effectors, then test it against waves of real drones before anyone deploys.</p>
          <div className="acct-stats">{STATS.map(([n, label]) => <div key={label}><b>{n}</b><span>{label}</span></div>)}</div>
          <ServerStatus api={api} />
        </section>
        <section className="acct-card" aria-label="Account">
          {tabs && (
            <>
              <div className="acct-tabs" role="tablist">
                <button role="tab" aria-selected={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
                <button role="tab" aria-selected={mode === 'register'} onClick={() => { setNotice(null); setMode('register'); }}>Create account</button>
              </div>
              <h2>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
              <p className="acct-sub">{mode === 'signin' ? 'Sign in to your profile and deployment packs.' : 'Your profile keeps your deployment packs: units of real equipment, ready to deploy.'}</p>
            </>
          )}
          {body}
        </section>
      </div>
    </main>
  );
}
