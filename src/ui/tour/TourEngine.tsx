/**
 * Interactive tutorial engine: spotlights real elements of the live app, explains them,
 * and for “try it” steps waits until the user has performed the action.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import type { Transaction } from '../../domain/types';
import { loadDemoData, removeDemoData } from '../../services/demo';
import { softDeleteTransactions } from '../../services/ledger';
import { getSetting, setSetting } from '../../services/settings';
import { nowIso } from '../../lib/dates';
import { useApp } from '../AppContext';
import { APP_DIALOG, resolveTarget, setControlValue } from './resolve';
import type { Tour, TourAction, TourCtx, TourStep } from './types';
import { TOURS, tourById } from './tours';

type Progress = Record<string, string>; // tourId → completedAt
const NO_PROGRESS: Progress = {};

interface Running {
  queue: string[];
  qi: number;
  step: number;
  startedAt: string;
  loadedPractice: boolean;
}

interface TourApi {
  running: boolean;
  progress: Progress;
  start: (ids: string | string[]) => void;
  stop: () => void;
  resetProgress: () => Promise<void>;
}

const Ctx = createContext<TourApi | null>(null);
export const useTour = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTour outside provider');
  return c;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => T | null, timeout = 3000): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(80);
  }
}

export function closeDialogs(): void {
  for (let i = 0; i < 3; i++) {
    if (!document.querySelector(APP_DIALOG)) return;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
}

async function runAction(a: TourAction): Promise<void> {
  if ('route' in a) {
    closeDialogs();
    await sleep(50);
    if (window.location.hash !== `#${a.route}`) window.location.hash = a.route;
    await sleep(350);
  } else if ('closeDialogs' in a) {
    closeDialogs();
    await sleep(150);
  } else if ('wait' in a) {
    await sleep(a.wait);
  } else if ('click' in a) {
    const el = await waitFor(() => resolveTarget(a.click));
    el?.click();
    await sleep(250);
  } else if ('select' in a || 'fill' in a) {
    const [t, v] = 'select' in a ? a.select : a.fill;
    const el = await waitFor(() => resolveTarget(t));
    if (el) setControlValue(el, v);
    await sleep(200);
  }
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { setFy, toast, run } = useApp();
  const [r, setR] = useState<Running | null>(null);
  const [pendingStart, setPendingStart] = useState<string[] | null>(null);
  const [finished, setFinished] = useState<Running | null>(null);
  const progress = useLiveQuery(() => getSetting<Progress>('tourProgress', {}), []) ?? NO_PROGRESS;

  const begin = useCallback(
    async (ids: string[], loadPractice: boolean | 'skip') => {
      setPendingStart(null);
      let loaded = false;
      if (loadPractice === true) {
        const ok = await run(() => loadDemoData(), { success: 'Practice data loaded (fictional, marked DEMO).' });
        loaded = ok !== undefined;
      }
      const hasDemo = (await getDb().transactions.filter((t) => !!t.isDemo).count()) > 0;
      if (hasDemo && ids.some((id) => tourById(id)?.needsData)) setFy(2025);
      setFinished(null);
      setR({ queue: ids, qi: 0, step: 0, startedAt: nowIso(), loadedPractice: loaded });
    },
    [run, setFy]
  );

  const start = useCallback(
    (idOrIds: string | string[]) => {
      const ids = (Array.isArray(idOrIds) ? idOrIds : [idOrIds]).filter((id) => tourById(id));
      if (!ids.length) return;
      void (async () => {
        const needs = ids.some((id) => tourById(id)?.needsData);
        const count = await getDb().transactions.count();
        if (needs && count === 0) setPendingStart(ids);
        else void begin(ids, 'skip');
      })();
    },
    [begin]
  );

  const complete = useCallback(async (tourId: string) => {
    const cur = await getSetting<Progress>('tourProgress', {});
    await setSetting('tourProgress', { ...cur, [tourId]: nowIso() });
  }, []);

  const stop = useCallback(() => setR(null), []);
  const resetProgress = useCallback(async () => {
    await setSetting('tourProgress', {});
    toast('Tutorial progress reset.');
  }, [toast]);

  const api = useMemo(() => ({ running: !!r, progress, start, stop, resetProgress }), [r, progress, start, stop, resetProgress]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {pendingStart && <PracticePrompt ids={pendingStart} onChoose={(load) => void begin(pendingStart, load)} onCancel={() => setPendingStart(null)} />}
      {r && (
        <TourOverlay
          key={`${r.qi}`}
          running={r}
          onStep={(step) => setR({ ...r, step })}
          onExit={() => setR(null)}
          onTourDone={async () => {
            const id = r.queue[r.qi];
            await complete(id);
            if (r.qi + 1 < r.queue.length) setR({ ...r, qi: r.qi + 1, step: 0 });
            else {
              setFinished(r);
              setR(null);
            }
          }}
        />
      )}
      {finished && <FinishCard running={finished} onClose={() => setFinished(null)} />}
    </Ctx.Provider>
  );
}

function PracticePrompt({ ids, onChoose, onCancel }: { ids: string[]; onChoose: (load: boolean) => void; onCancel: () => void }) {
  const t = tourById(ids[0]);
  return (
    <div className="tour-modal" role="dialog" aria-label="Start tutorial">
      <div className="tour-card static">
        <div className="tour-kicker">Tutorial</div>
        <h3>{ids.length > 1 ? 'Complete course' : t?.title}</h3>
        <p>This tutorial is easiest to follow with <b>practice data</b> — fictional accounts, trades, income and exchange rates, all clearly marked “DEMO”. You can remove them in one click when you finish (Settings → Data health).</p>
        <div className="tour-actions">
          <button className="primary" onClick={() => onChoose(true)}>
            Load practice data & start
          </button>
          <button onClick={() => onChoose(false)}>Start without it</button>
          <button className="link" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function FinishCard({ running, onClose }: { running: Running; onClose: () => void }) {
  const { run } = useApp();
  const created = useLiveQuery(() => getDb().transactions.filter((t) => t.status === 'active' && t.source === 'manual' && t.createdAt >= running.startedAt).toArray(), [running.startedAt], []) ?? [];
  const hasDemo = useLiveQuery(async () => (await getDb().transactions.filter((t) => !!t.isDemo).count()) > 0, [], false);
  const titles = running.queue.map((id) => tourById(id)?.title).filter(Boolean);
  return (
    <div className="tour-modal" role="dialog" aria-label="Tutorial complete">
      <div className="tour-card static">
        <div className="tour-kicker">Tutorial complete</div>
        <h3>Well done!</h3>
        <p>You finished: {titles.join(', ')}.</p>
        {created.length > 0 && (
          <p>
            You created <b>{created.length}</b> practice record(s) during the tutorial.{' '}
            <button className="small" onClick={() => run(() => softDeleteTransactions(created.map((t: Transaction) => t.id), 'Tutorial practice record'), { success: 'Practice records deleted.' })}>
              Delete them
            </button>
          </p>
        )}
        {hasDemo && (
          <p>
            Practice (DEMO) data is still loaded.{' '}
            <button className="small" onClick={() => run(() => removeDemoData(), { success: 'Practice data removed.' })}>
              Remove practice data
            </button>
          </p>
        )}
        <p className="faint">Find every tutorial again under “Tutorials” in the menu or the Tutorial button at the top.</p>
        <div className="tour-actions">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function renderBody(body: string): ReactNode {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>));
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((para, i) => {
      const lines = para.split('\n').map((l) => l.trim());
      if (lines.every((l) => l.startsWith('- ')))
        return (
          <ul key={i}>
            {lines.map((l, j) => (
              <li key={j}>{inline(l.slice(2))}</li>
            ))}
          </ul>
        );
      return <p key={i}>{inline(lines.join(' '))}</p>;
    });
}

function TourOverlay({ running, onStep, onExit, onTourDone }: { running: Running; onStep: (n: number) => void; onExit: () => void; onTourDone: () => void }) {
  const tour = tourById(running.queue[running.qi]) as Tour;
  const step: TourStep = tour.steps[running.step];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [status, setStatus] = useState<'none' | 'pending' | 'found' | 'missing'>('pending');
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 380, h: 220 });
  const total = tour.steps.length;
  const last = running.step === total - 1;

  const ctx: TourCtx = useMemo(
    () => ({
      startedAt: running.startedAt,
      find: resolveTarget,
      dialogOpen: () => !!document.querySelector(APP_DIALOG),
      countCreatedSince: async (f) => getDb().transactions.filter((t) => t.status === 'active' && t.createdAt >= running.startedAt && (!f || f(t))).count()
    }),
    [running.startedAt]
  );

  // Prepare the step: navigate, run actions, locate the target.
  useEffect(() => {
    let alive = true;
    setReady(false);
    setDone(false);
    setSkipped(false);
    setRect(null);
    setStatus(step.target ? 'pending' : 'none');
    (async () => {
      if (step.route) await runAction({ route: step.route });
      for (const a of step.before ?? []) {
        if (!alive) return;
        await runAction(a);
      }
      if (!alive) return;
      if (step.target) {
        const el = await waitFor(() => resolveTarget(step.target!), 2500);
        if (!alive) return;
        if (el) {
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          setStatus('found');
        } else setStatus('missing');
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [tour.id, running.step, step]);

  // Track the target's position (it can move as the page re-renders or scrolls).
  useEffect(() => {
    if (!step.target) return;
    const tick = () => {
      const el = resolveTarget(step.target!);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    tick();
    const h = setInterval(tick, 250);
    window.addEventListener('resize', tick);
    window.addEventListener('scroll', tick, true);
    return () => {
      clearInterval(h);
      window.removeEventListener('resize', tick);
      window.removeEventListener('scroll', tick, true);
    };
  }, [step.target, ready]);

  // Interactive steps: poll until the user has done it.
  useEffect(() => {
    if (!step.tryIt || !ready) return;
    let alive = true;
    const h = setInterval(async () => {
      try {
        if (await step.tryIt!.check(ctx)) {
          if (alive) setDone(true);
        }
      } catch {
        /* keep waiting */
      }
    }, 500);
    return () => {
      alive = false;
      clearInterval(h);
    };
  }, [step, ready, ctx]);

  useEffect(() => {
    if (cardRef.current) setCardSize({ w: cardRef.current.offsetWidth, h: cardRef.current.offsetHeight });
  }, [running.step, ready, done]);

  const next = () => {
    if (last) onTourDone();
    else onStep(running.step + 1);
  };
  const back = () => running.step > 0 && onStep(running.step - 1);

  // Card position: below / above / beside the target, clamped to the viewport.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 8;
  let pos: { left: number; top: number };
  if (rect && status === 'found') {
    const below = rect.bottom + 12;
    const above = rect.top - cardSize.h - 12;
    let top = below + cardSize.h < vh - pad ? below : above > pad ? above : Math.min(vh - cardSize.h - pad, Math.max(pad, rect.top));
    let left = Math.min(Math.max(pad, rect.left), vw - cardSize.w - pad);
    if (top === Math.min(vh - cardSize.h - pad, Math.max(pad, rect.top)) && rect.right + cardSize.w + 16 < vw) left = rect.right + 12;
    else if (top === Math.min(vh - cardSize.h - pad, Math.max(pad, rect.top)) && rect.left - cardSize.w - 16 > 0) left = rect.left - cardSize.w - 12;
    top = Math.max(pad, Math.min(top, vh - cardSize.h - pad));
    pos = { left, top };
  } else pos = { left: Math.max(pad, (vw - cardSize.w) / 2), top: Math.max(pad, (vh - cardSize.h) / 2) };

  const needAction = !!step.tryIt && !done && !skipped;
  return (
    <>
      {rect && status === 'found' ? (
        <div className="tour-spot" style={{ left: rect.left - 5, top: rect.top - 5, width: rect.width + 10, height: rect.height + 10 }} />
      ) : (
        <div className="tour-mask" />
      )}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-label={`Tutorial: ${tour.title}`}
        data-tour-id={tour.id}
        data-step={running.step}
        data-target-status={status}
        data-ready={ready ? 'true' : 'false'}
        style={{ left: pos.left, top: pos.top }}
      >
        <div className="tour-kicker">
          {running.queue.length > 1 ? `Course ${running.qi + 1}/${running.queue.length} · ` : ''}
          {tour.title} · step {running.step + 1} of {total}
        </div>
        <div className="tour-progress">
          <div style={{ width: `${((running.step + 1) / total) * 100}%` }} />
        </div>
        <h3>{step.title}</h3>
        <div className="tour-body">{renderBody(step.body)}</div>
        {status === 'missing' && <p className="tour-note">This item isn’t on screen right now (it may need data or a different selection). The explanation still applies.</p>}
        {step.tryIt && (
          <div className={`tour-try ${done ? 'done' : skipped ? 'skipped' : ''}`}>
            <b>{done ? '✓ Done!' : skipped ? 'Skipped' : 'Your turn:'}</b> {step.tryIt.hint}
          </div>
        )}
        <div className="tour-actions">
          <button onClick={onExit} className="link">
            Exit tutorial
          </button>
          <span className="spacer" />
          <button onClick={back} disabled={running.step === 0}>
            Back
          </button>
          {needAction && (
            <button onClick={() => setSkipped(true)} aria-label="Skip this step">
              Skip
            </button>
          )}
          <button className="primary" onClick={next} disabled={needAction || !ready}>
            {last ? (running.qi + 1 < running.queue.length ? 'Next tutorial' : 'Finish') : 'Next'}
          </button>
        </div>
      </div>
    </>
  );
}

export { TOURS };
