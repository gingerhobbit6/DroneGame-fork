// Saving finished runs without ever silently losing one. Every run is copied to this browser before it is sent, and the copy
// goes once the server has answered, so closing the page at any moment loses nothing. A run the server refuses outright is
// reported and dropped, because retrying would never help.
// shortcut: if the page closes or the connection drops after the server stored a run but before its answer arrived, or two tabs flush together, the run is saved twice. That is a duplicate row the player can delete, never a lost run. Send an id the server deduplicates on if it matters.

const KEY = 'site-guard.unsaved-runs';
const MAX_KEPT = 50;

export function createRunSaver({ api, storage, notify, onChange }) {
  let lastMessage = '';
  let flushing = false, savedCount = 0;
  const sending = new Set(); // ids this page is saving right now, so a flush does not send them too
  const say = (msg, loud = true) => { lastMessage = msg; if (loud) notify(msg); onChange(); };

  function read() {
    try {
      const kept = JSON.parse(storage.getItem(KEY));
      return Array.isArray(kept) ? kept.filter((e) => e?.id && e.run) : [];
    } catch { return []; }
  }
  function write(entries) {
    try {
      if (entries.length) storage.setItem(KEY, JSON.stringify(entries)); else storage.removeItem(KEY);
      return true;
    } catch { return false; }
  }
  const forget = (id) => write(read().filter((e) => e.id !== id));
  const waiting = () => read().filter((e) => !sending.has(e.id));

  // Keep a run for later and return its id, or null if it could not be kept. Synchronous, so it works while the page is closing.
  function keep(run) {
    const id = `${Date.now()}-${Math.random()}`;
    const kept = [...read(), { id, run }];
    if (!write(kept.slice(-MAX_KEPT))) return null;
    if (kept.length > MAX_KEPT) notify(`The oldest kept run was dropped: this browser holds at most ${MAX_KEPT} waiting to be saved.`);
    onChange();
    return id;
  }

  async function save(run) {
    const id = keep(run);
    sending.add(id);
    let failure = null;
    try { await api.runs.create(run); } catch (e) { failure = e; }
    sending.delete(id);
    if (!failure?.retryable) forget(id);
    if (!failure) {
      savedCount++;
      say('Run saved to your history.', false);
      if (waiting().length) await flush(); // the server is back, so the runs kept while it was down go now too
    } else if (!failure.retryable) say(`This run could not be saved: ${failure.message}`);
    else if (id && failure.status === 401) say('You are signed out, so this run is being kept in this browser. It will be saved when you sign in again.');
    else if (id) say('The save server is not running, so this run is being kept in this browser. It will be saved when the server is back.');
    else say('This run could not be saved or kept: the save server is down and browser storage is full or blocked.');
  }

  // Try again with every kept run. Returns how many were saved.
  async function flush() {
    if (flushing) return 0;
    flushing = true;
    let saved = 0, refused = 0;
    try {
      for (const { id, run } of waiting()) {
        try {
          await api.runs.create(run);
          saved++; savedCount++;
        } catch (e) {
          if (e.retryable) continue; // keep it, and still try the rest: one run the server fails on must not block them
          refused++;
          notify(`A kept run could not be saved: ${e.message}`);
        }
        forget(id);
      }
    } finally {
      flushing = false;
    }
    if (saved) say(`${saved} kept run${saved > 1 ? 's' : ''} saved to your history.`);
    else if (refused) onChange();
    return saved;
  }

  return { keep, save, flush, pending: () => waiting().length, message: () => lastMessage, saved: () => savedCount };
}
