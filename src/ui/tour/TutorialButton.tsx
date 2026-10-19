import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toursForRoute } from './tours';
import { useTour } from './TourEngine';

/** Top-bar “Tutorial” button: lists the tutorials for the current section. */
export function TutorialButton() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const { start, progress, running } = useTour();
  const tours = toursForRoute(loc.pathname);
  if (running) return null;
  return (
    <span style={{ position: 'relative' }}>
      <button className="small" aria-expanded={open} aria-label="Tutorial" onClick={() => setOpen((v) => !v)}>
        ? Tutorial
      </button>
      {open && (
        <div className="tutorial-menu" onMouseLeave={() => setOpen(false)}>
          <div className="faint" style={{ padding: '2px 8px 6px' }}>
            Tutorials for this section
          </div>
          {tours.map((t) => (
            <button
              key={t.id}
              className="item"
              onClick={() => {
                setOpen(false);
                start(t.id);
              }}
            >
              <div>
                {progress[t.id] ? '✓ ' : ''}
                {t.title}
              </div>
              <div className="faint" style={{ fontSize: 11 }}>
                {t.steps.length} steps · ~{t.minutes} min
              </div>
            </button>
          ))}
          {!tours.length && <div className="muted" style={{ padding: 8 }}>No section-specific tutorial here.</div>}
          <button
            className="item"
            onClick={() => {
              setOpen(false);
              nav('/tutorials');
            }}
          >
            <b>All tutorials & complete course →</b>
          </button>
        </div>
      )}
    </span>
  );
}
