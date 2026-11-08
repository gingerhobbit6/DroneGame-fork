// Pieces the login page and the profile hub share: the logo, password fields, the strength meter, the recovery code and a clock.

import { useEffect, useId, useState } from 'react';

export const MIN_PASSWORD = 10; // MIN_PASSWORD in backend/app/account_schemas.py
export const USERNAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/;

export const Logo = ({ title = 'SITE GUARD' }) => (
  <div className="acct-logo">
    <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M24 3 L42 10 V24 C42 35 34 42 24 45 C14 42 6 35 6 24 V10 Z" />
      <circle cx="24" cy="24" r="9" opacity="0.7" /><circle cx="24" cy="24" r="2" fill="currentColor" />
      <path d="M24 24 L33 15" />
    </svg>
    <h1>{title}</h1>
  </div>
);

// How hard a password would be to guess, as a nudge: the server's only rule is the length.
export function passwordStrength(password, username = '') {
  if (!password) return { score: 0, label: '' };
  if (password.length < MIN_PASSWORD) return { score: 1, label: `Too short: at least ${MIN_PASSWORD} characters` };
  if (username && password.toLowerCase().includes(username.toLowerCase())) return { score: 1, label: 'Do not use your username in it' };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const unique = new Set(password).size;
  let score = password.length >= 16 ? 3 : 2;
  if (kinds >= 3 || password.includes(' ')) score += 1;
  if (unique < password.length / 3) score -= 1; // aaaaaaaaaa or abcabcabc
  score = Math.max(1, Math.min(4, score));
  return { score, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][score] + (score < 3 ? ': a few unrelated words make a strong one' : '') };
}

export function Meter({ password, username }) {
  const { score, label } = passwordStrength(password, username);
  return (
    <>
      <div className="acct-meter" data-score={score} aria-hidden="true"><i /><i /><i /><i /></div>
      <span className="acct-meter-text" aria-live="polite">{label}</span>
    </>
  );
}

// A password with a show/hide button, which warns when Caps Lock is on.
export function PasswordField({ label, value, onChange, autoComplete, hint, invalid, children, name }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const watchCaps = (e) => setCaps(!!e.getModifierState?.('CapsLock'));
  return (
    <label className="acct-field" htmlFor={id}>
      {label}{hint && <small>{hint}</small>}
      <span className="acct-input">
        <input id={id} name={name} type={shown ? 'text' : 'password'} value={value} autoComplete={autoComplete} required maxLength={128} spellCheck={false}
          aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} onKeyUp={watchCaps} onKeyDown={watchCaps} />
        <button type="button" className="acct-reveal" aria-pressed={shown} aria-label={shown ? 'Hide the password' : 'Show the password'} onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>
      </span>
      {caps && <span className="acct-caps" role="status">Caps Lock is on</span>}
      {children}
    </label>
  );
}

export function TextField({ label, value, onChange, hint, ...input }) {
  const id = useId();
  return (
    <label className="acct-field" htmlFor={id}>
      {label}{hint && <small>{hint}</small>}
      <input id={id} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} {...input} />
    </label>
  );
}

// The recovery code, shown once. Nothing goes on until the player says it is saved.
export function RecoveryCode({ code, title, children, onDone, doneLabel }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const copy = () => navigator.clipboard?.writeText(code).then(() => setCopied(true), () => setCopied(false));
  return (
    <div className="acct-form">
      <h2>{title}</h2>
      <p className="acct-sub">{children}</p>
      <div className="acct-code" id="recovery-code">{code}</div>
      <button type="button" className="acct-ghost" onClick={copy}>{copied ? 'Copied' : 'Copy the code'}</button>
      <label className="acct-check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved it somewhere safe</label>
      <button type="button" className="acct-go" disabled={!saved} onClick={onDone}>{doneLabel}</button>
    </div>
  );
}

const zulu = () => `${new Date().toISOString().slice(11, 19)}Z`;
export function ZuluClock() {
  const [now, setNow] = useState(zulu);
  useEffect(() => { const t = setInterval(() => setNow(zulu()), 1000); return () => clearInterval(t); }, []);
  return <span className="acct-clock" aria-label="Time in UTC">{now}</span>;
}

// Runs a request with a busy flag and an error message, for the forms.
export function useRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e.message); return undefined; } finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
