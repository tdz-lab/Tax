/** Minimal responsive SVG line chart (cumulative series over a financial year). No chart library. */
import { formatMoney } from '../../lib/decimal';

export interface Series {
  label: string;
  color: string;
  /** Cumulative values at each day index (0 = 1 July). */
  points: { day: number; value: number }[];
}

const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const MONTH_START = [0, 31, 62, 92, 123, 153, 184, 215, 243, 274, 304, 335];

export function LineChart({ series, days, height = 220, emptyText }: { series: Series[]; days: number; height?: number; emptyText?: string }) {
  const W = 760;
  const H = height;
  const pad = { l: 64, r: 12, t: 12, b: 26 };
  const all = series.flatMap((s) => s.points.map((p) => p.value));
  if (!all.length) return <div className="empty">{emptyText ?? 'Nothing recorded yet for this year.'}</div>;
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  if (max === min) max = min + 1;
  const span = max - min;
  min -= span * 0.05;
  max += span * 0.08;
  const x = (d: number) => pad.l + (d / Math.max(1, days - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);
  const ticks = 4;
  const tickVals = Array.from({ length: ticks + 1 }, (_, i) => min + ((max - min) * i) / ticks);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-box" style={{ height }} role="img" aria-label={`Chart: ${series.map((s) => s.label).join(', ')}`}>
        {tickVals.map((v, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={10.5} fill="var(--faint)">
              {formatMoney(Math.round(v).toString(), 'AUD', { dp: 0 })}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
        {MONTH_START.map((d, i) => (
          <text key={i} x={x(d)} y={H - 8} fontSize={10.5} fill="var(--faint)">
            {MONTHS[i]}
          </text>
        ))}
        {series.map((s) => {
          if (!s.points.length) return null;
          const pts = [{ day: 0, value: 0 }, ...s.points];
          const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.day).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
          return <path key={s.label} d={path} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" />;
        })}
      </svg>
      <div className="row" style={{ justifyContent: 'center', gap: 16 }}>
        {series.map((s) => (
          <span key={s.label} className="row" style={{ gap: 5 }}>
            <span style={{ width: 14, height: 3, background: s.color, display: 'inline-block' }} />
            <span className="muted">{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
