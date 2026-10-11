import { DbConnection, tables } from './module_bindings';
import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const HOST = 'ws://127.0.0.1:3000';
const DB_NAME = 'tradeoff-lab-gmqwi';
const CONVEX_URL = import.meta.env.VITE_CONVEX_URL ?? 'http://127.0.0.1:3210';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

type LaneName = 'stdb' | 'convex' | 'supabase';

const lanes = {
  stdb: document.querySelector<HTMLElement>('[data-lane="stdb"]')!,
  convex: document.querySelector<HTMLElement>('[data-lane="convex"]')!,
  supabase: document.querySelector<HTMLElement>('[data-lane="supabase"]')!,
};

const screen: Record<LaneName, string[]> = { stdb: [], convex: [], supabase: [] };

const form = document.querySelector<HTMLFormElement>('#composer')!;
const bodyInput = document.querySelector<HTMLInputElement>('#body')!;
const countInput = document.querySelector<HTMLInputElement>('#count')!;
const sizeInput = document.querySelector<HTMLInputElement>('#size')!;
const burstButton = document.querySelector<HTMLButtonElement>('#burst')!;
const attemptBody = document.querySelector<HTMLElement>('#attempts')!;
const buttons = Array.from(document.querySelectorAll('button'));

type Attempt = {
  count: number;
  save: Record<LaneName, number | null>;
  read: number | null;
};

const attempts: Attempt[] = [];
let roundSave: Record<LaneName, number | null> = { stdb: null, convex: null, supabase: null };
let roundRead: number | null = null;

let conn: DbConnection;
let convex: ConvexClient | null = null;
let ready = false;
let stdbReady = false;
let convexReady = false;
let busy = false;
const laneTrouble: Record<LaneName, boolean> = {
  stdb: false,
  convex: false,
  supabase: false,
};
let supabase: SupabaseClient | null = null;

function setStatus(name: LaneName, text: string) {
  lanes[name].querySelector('.status')!.textContent = text;
}

function paintWait() {
  if (ready) return;
  setStatus('stdb', stdbReady ? 'connection open' : 'opening the connection');
  setStatus('convex', convexReady ? 'connection open' : 'opening the connection');
  const waiting = [!stdbReady ? 'SpacetimeDB' : '', !convexReady ? 'Convex' : ''].filter(Boolean);
  const line =
    waiting.length === 2 ? 'send waits for SpacetimeDB and Convex' : `send waits for ${waiting[0]}`;
  setStatus('supabase', line);
}

function openForBusiness() {
  if (!stdbReady || !convexReady || ready) return;
  ready = true;
  setBusy(true);
  (Object.keys(lanes) as LaneName[]).forEach(name => setStatus(name, 'clearing'));
  clearAll().finally(() => setBusy(false));
}

function shownMs(ms: number): number {
  return ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms);
}

function msLabel(ms: number): string {
  return `${ms < 10 ? ms.toFixed(1) : shownMs(ms)} ms`;
}

function chosenCount(): number | null {
  const raw = countInput.value.trim() || countInput.placeholder;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) return null;
  return count;
}

function chosenSizeBytes(): number | null {
  const kb = Number(sizeInput.value);
  if (!Number.isInteger(kb) || kb < 1 || kb > 1024) return null;
  return kb * 1024;
}

function sizedBody(text: string, bytes: number | null): string {
  if (bytes == null) return text;
  if (text.length >= bytes) return text.slice(0, bytes);
  return text + 'x'.repeat(bytes - text.length);
}

function refreshBurstLabel() {
  const count = chosenCount();
  burstButton.textContent = count ? `Send ${count}` : 'Send them';
}

function blankRound() {
  roundSave = { stdb: null, convex: null, supabase: null };
  roundRead = null;
}

function rememberSave(name: LaneName, ms: number) {
  roundSave[name] = shownMs(ms);
  setReq(name, 'save', msLabel(roundSave[name]!));
}

function rememberRead(ms: number) {
  roundRead = shownMs(ms);
  setReq('supabase', 'read', msLabel(roundRead));
}

function added(values: Array<number | null>): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    if (value == null) continue;
    any = true;
    total += value;
  }
  return any ? total : null;
}

function supabaseTotal(attempt: Attempt): number | null {
  return added([attempt.save.supabase, attempt.read]);
}

function paintAttempts() {
  attemptBody.replaceChildren();
  for (const attempt of attempts) {
    const row = document.createElement('tr');
    const values = [attempt.save.stdb, attempt.save.convex, supabaseTotal(attempt)];
    const cells = [String(attempt.count), ...values.map(value => (value == null ? '—' : msLabel(value)))];
    for (const text of cells) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    attemptBody.append(row);
  }
}

function commitAttempt(count: number) {
  attempts.push({ count, save: { ...roundSave }, read: roundRead });
  paintAttempts();
}

function wire(name: LaneName, live: boolean) {
  lanes[name].querySelector('.conn')!.classList.toggle('live', live);
}

function setLoader(name: LaneName, text: 'sending' | 'reading' | null) {
  const loader = lanes[name].querySelector<HTMLElement>('.loader');
  if (!loader) return;
  const label = loader.querySelector('span');
  if (!text) {
    loader.hidden = true;
    return;
  }
  if (label) label.textContent = text;
  loader.hidden = false;
}

function mark(name: LaneName, kind: 'save' | 'read' | null) {
  lanes[name].querySelector('.save-row')!.classList.toggle('active', kind === 'save');
  lanes[name].querySelector('.read-row')!.classList.toggle('active', kind === 'read');
}

function setReq(name: LaneName, kind: 'save' | 'read' | 'slow', text: string) {
  lanes[name].querySelector(`.${kind}`)!.textContent = text;
}

function paint() {
  (Object.keys(lanes) as LaneName[]).forEach(name => {
    const list = lanes[name].querySelector('.slips')!;
    list.replaceChildren();
    const slip = document.createElement('li');
    if (screen[name].length === 0) {
      slip.className = 'empty';
      slip.textContent = '(empty)';
    } else {
      slip.className = 'slip';
      const count = screen[name].length;
      slip.textContent = count === 1 ? '1 message' : `${count} messages`;
    }
    list.append(slip);
  });
}

function setBusy(value: boolean) {
  busy = value;
  const off = value || !ready;
  for (const button of buttons) button.disabled = off;
  bodyInput.disabled = off;
  countInput.disabled = off;
  sizeInput.disabled = off;
  if (!off) {
    (Object.keys(lanes) as LaneName[]).forEach(name => {
      if (!laneTrouble[name]) setStatus(name, 'ready');
    });
  }
}

function beginRound() {
  (Object.keys(lanes) as LaneName[]).forEach(name => {
    laneTrouble[name] = false;
  });
}

function noteFailure(name: LaneName, text: string) {
  laneTrouble[name] = true;
  setLoader(name, null);
  wire(name, false);
  mark(name, null);
  setStatus(name, text);
}

function cacheRows(): string[] {
  return [...conn.db.note.iter()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(row => row.body);
}

function syncStdb() {
  screen.stdb = cacheRows();
  paint();
}

async function finishSupabaseRead() {
  if (laneTrouble.supabase) return;
  await readSupabase();
}

async function readSupabase() {
  if (!supabase || laneTrouble.supabase) return;
  setLoader('supabase', 'reading');
  setStatus('supabase', 'reading');
  wire('supabase', true);
  mark('supabase', 'read');
  try {
    const started = performance.now();
    const pageSize = 1000;
    const bodies: string[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from('note')
        .select('body')
        .order('id')
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const rows = data ?? [];
      for (const row of rows) bodies.push(String(row.body));
      if (rows.length < pageSize) break;
    }
    screen.supabase = bodies;
    rememberRead(performance.now() - started);
    paint();
  } catch {
    noteFailure('supabase', 'read timed out');
  } finally {
    wire('supabase', false);
    mark('supabase', null);
    setLoader('supabase', null);
  }
}

async function saveAll(body: string) {
  beginRound();
  blankRound();
  (Object.keys(lanes) as LaneName[]).forEach(name => {
    wire(name, true);
    mark(name, 'save');
    setStatus(name, 'saving');
  });
  await Promise.allSettled([
    (async () => {
      try {
        const started = performance.now();
        await conn.reducers.addNote({ body });
        syncStdb();
        rememberSave('stdb', performance.now() - started);
        wire('stdb', false);
        mark('stdb', null);
        setStatus('stdb', 'saved');
      } catch {
        noteFailure('stdb', 'save timed out');
      }
    })(),
    (async () => {
      if (!convex) return;
      setLoader('convex', 'sending');
      try {
        const started = performance.now();
        await convex.mutation(api.notes.send, { body });
        rememberSave('convex', performance.now() - started);
        setStatus('convex', 'saved');
      } catch {
        noteFailure('convex', 'save timed out');
      } finally {
        wire('convex', false);
        mark('convex', null);
        setLoader('convex', null);
      }
    })(),
    (async () => {
      if (!supabase) return;
      setLoader('supabase', 'sending');
      try {
        const started = performance.now();
        const { error } = await supabase.from('note').insert({ body });
        if (error) throw new Error(error.message);
        rememberSave('supabase', performance.now() - started);
        setReq('supabase', 'read', '—');
        setStatus('supabase', 'saved');
        paint();
      } catch {
        noteFailure('supabase', 'save timed out');
      } finally {
        wire('supabase', false);
        mark('supabase', null);
        setLoader('supabase', null);
      }
      await finishSupabaseRead();
    })(),
  ]);

  commitAttempt(1);
}

async function burstAll(count: number) {
  beginRound();
  blankRound();
  const bytes = chosenSizeBytes();
  const bodies = Array.from({ length: count }, (_, i) => sizedBody(String(i + 1), bytes));
  (Object.keys(lanes) as LaneName[]).forEach(name => {
    wire(name, true);
    mark(name, 'save');
    setReq(name, 'slow', '—');
    setStatus(name, `saving ${count}`);
  });
  setReq('supabase', 'read', '—');

  async function burst(write: (body: string) => Promise<void>) {
    const wall = performance.now();
    let slowest = 0;
    await Promise.all(
      bodies.map(async body => {
        const started = performance.now();
        await write(body);
        slowest = Math.max(slowest, performance.now() - started);
      }),
    );
    return { total: performance.now() - wall, slowest };
  }

  await Promise.allSettled([
    (async () => {
      try {
        const times = await burst(body => conn.reducers.addNote({ body }));
        syncStdb();
        rememberSave('stdb', times.total);
        setReq('stdb', 'slow', msLabel(times.slowest));
        wire('stdb', false);
        mark('stdb', null);
        setStatus('stdb', 'saved');
      } catch {
        noteFailure('stdb', 'save timed out');
      }
    })(),
    (async () => {
      if (!convex) return;
      setLoader('convex', 'sending');
      try {
        const times = await burst(async body => {
          await convex!.mutation(api.notes.send, { body });
        });
        rememberSave('convex', times.total);
        setReq('convex', 'slow', msLabel(times.slowest));
        setStatus('convex', 'saved');
      } catch {
        noteFailure('convex', 'save timed out');
      } finally {
        wire('convex', false);
        mark('convex', null);
        setLoader('convex', null);
      }
    })(),
    (async () => {
      if (!supabase) return;
      setLoader('supabase', 'sending');
      try {
        const times = await burst(async body => {
          const { error } = await supabase!.from('note').insert({ body });
          if (error) throw new Error(error.message);
        });
        rememberSave('supabase', times.total);
        setReq('supabase', 'slow', msLabel(times.slowest));
        setStatus('supabase', 'saved');
      } catch {
        noteFailure('supabase', 'save timed out');
      } finally {
        wire('supabase', false);
        mark('supabase', null);
        setLoader('supabase', null);
      }
      await finishSupabaseRead();
    })(),
  ]);

  commitAttempt(count);
}

async function clearAll() {
  beginRound();
  (Object.keys(lanes) as LaneName[]).forEach(name => setStatus(name, 'clearing'));
  try {
    await Promise.all([
      conn.reducers.clearNotes({}),
      convex ? convex.mutation(api.notes.clear, {}) : Promise.resolve(),
      supabase ? supabase.from('note').delete().gte('id', 0) : Promise.resolve(),
    ]);
    screen.supabase = [];
    syncStdb();
    (Object.keys(lanes) as LaneName[]).forEach(name => {
      wire(name, false);
      mark(name, null);
      setReq(name, 'save', '—');
      setReq(name, 'slow', '—');
      setReq(name, 'read', '—');
      setLoader(name, null);
    });
  } catch {
    (Object.keys(lanes) as LaneName[]).forEach(name => noteFailure(name, 'clear timed out'));
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (document.activeElement === countInput) {
    burstButton.click();
    return;
  }
  const typed = bodyInput.value.trim() || bodyInput.placeholder;
  const bytes = chosenSizeBytes();
  if (!typed || busy || !ready) return;
  bodyInput.value = '';
  setBusy(true);
  saveAll(sizedBody(typed, bytes)).finally(() => setBusy(false));
});

countInput.addEventListener('input', refreshBurstLabel);

burstButton.addEventListener('click', () => {
  const count = chosenCount();
  if (count == null || busy || !ready) return;
  setBusy(true);
  burstAll(count).finally(() => setBusy(false));
});

document.querySelector('#clear')!.addEventListener('click', () => {
  if (busy || !ready) return;
  setBusy(true);
  clearAll().finally(() => setBusy(false));
});

setBusy(false);
paint();
paintWait();
refreshBurstLabel();

convex = new ConvexClient(CONVEX_URL);
convex.onUpdate(api.notes.list, {}, notes => {
  screen.convex = notes;
  paint();
  if (!convexReady) {
    convexReady = true;
    paintWait();
    openForBusiness();
  }
});

supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

conn = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(localStorage.getItem('two-tests-token') ?? undefined)
  .onConnect((connection, _identity, token) => {
    localStorage.setItem('two-tests-token', token);
    conn = connection;
    connection.db.note.onInsert(() => syncStdb());
    connection.db.note.onDelete(() => syncStdb());
    connection
      .subscriptionBuilder()
      .onApplied(() => {
        stdbReady = true;
        paintWait();
        openForBusiness();
      })
      .subscribe(tables.note);
  })
  .build();
