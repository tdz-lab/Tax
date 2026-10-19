import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../../db/schema';
import { formatInstant } from '../../lib/dates';
import { loadDemoData, removeDemoData } from '../../services/demo';
import { useApp } from '../AppContext';
import { COURSE, TOUR_GROUPS, TOURS } from '../tour/tours';
import { useTour } from '../tour/TourEngine';

export function Tutorials() {
  const { start, progress, resetProgress } = useTour();
  const { run, settings, setFy } = useApp();
  const hasDemo = useLiveQuery(async () => (await getDb().transactions.filter((t) => !!t.isDemo).count()) > 0, [], false);
  const done = TOURS.filter((t) => progress[t.id]).length;
  const totalSteps = TOURS.reduce((s, t) => s + t.steps.length, 0);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tutorials</h1>
          <span className="muted">
            {TOURS.length} interactive tutorials · {totalSteps} steps · {done} completed
          </span>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => start('getting-started')}>
            Quick start (4 min)
          </button>
          <button onClick={() => start(COURSE)}>Complete course — every tutorial in order</button>
          <button className="small" onClick={() => void resetProgress()}>
            Reset progress
          </button>
        </div>
      </div>
      <div className="panel">
        <h2>How tutorials work</h2>
        <ul className="list-plain">
          <li>The tutorial moves around the real app, highlights each button, field or table and explains it. Use <b>Next</b> / <b>Back</b>; <b>Exit tutorial</b> stops at any time.</li>
          <li>Steps marked <b>Your turn</b> wait until you try it (or press <b>Skip</b>).</li>
          <li>Tutorials marked <span className="badge accent">uses practice data</span> are easiest with the fictional practice data loaded — you’ll be offered it if you have no records yet.</li>
          <li>At the end you can delete any practice records you created during the tutorial.</li>
          <li>The <b>Tutorial</b> button at the top right of every page lists the tutorials for that section.</li>
        </ul>
        <div className="row" style={{ marginTop: 6 }}>
          <span className="muted">Practice data:</span>
          {hasDemo ? (
            <>
              <span className="badge ok">loaded (FY2024–25)</span>
              {settings.selectedFY !== 2025 && (
                <button className="small" onClick={() => setFy(2025)}>
                  Switch to FY2024–25
                </button>
              )}
              <button className="small danger" onClick={() => run(() => removeDemoData(), { success: 'Practice data removed.' })}>
                Remove practice data
              </button>
            </>
          ) : (
            <button className="small" onClick={() => run(() => loadDemoData(), { success: 'Practice data loaded (fictional, marked DEMO).' }).then(() => setFy(2025))}>
              Load practice data
            </button>
          )}
        </div>
      </div>
      {TOUR_GROUPS.map((g) => (
        <div key={g.title} className="panel">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{g.title}</h2>
            <span className="spacer" />
            {g.tours.length > 1 && (
              <button className="small" onClick={() => start(g.tours.map((t) => t.id))}>
                Run all {g.tours.length} in this section
              </button>
            )}
          </div>
          <div className="tutorial-grid">
            {g.tours.map((t) => (
              <div key={t.id} className="tutorial-item" data-tour-item={t.id}>
                <h3>
                  {progress[t.id] && <span title={`Completed ${formatInstant(progress[t.id], settings.taxTimeZone)}`}>✓ </span>}
                  {t.title}
                </h3>
                <span className="muted">{t.summary}</span>
                <div className="row">
                  <span className="faint">
                    {t.steps.length} steps · ~{t.minutes} min
                  </span>
                  {t.needsData && <span className="badge accent">uses practice data</span>}
                  <span className="spacer" />
                  <button className="small primary" aria-label={`Start tutorial: ${t.title}`} onClick={() => start(t.id)}>
                    {progress[t.id] ? 'Replay' : 'Start'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
