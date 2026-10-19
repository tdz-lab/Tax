/** Searchable, sortable, paginated table with configurable columns and optional row selection. */
import { useMemo, useState, type ReactNode } from 'react';
import { useSessionState } from '../AppContext';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number | null | undefined;
  searchValue?: (row: T) => string;
  numeric?: boolean;
  hidden?: boolean; // hidden by default (user can enable)
  width?: number;
}

interface Props<T> {
  id: string; // persistence key for sort / columns / page size
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (s: Set<string>) => void;
  toolbar?: ReactNode;
  footer?: ReactNode;
  emptyText?: ReactNode;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  pageSize?: number;
  search?: boolean;
  short?: boolean;
  rowClass?: (row: T) => string | undefined;
}

export function DataTable<T>({ id, rows, columns, rowKey, onRowClick, selectable, selected, onSelectedChange, toolbar, footer, emptyText, defaultSort, pageSize = 50, search = true, short, rowClass }: Props<T>) {
  const [sort, setSort] = useSessionState<{ key: string; dir: 'asc' | 'desc' } | null>(`dt:${id}:sort`, defaultSort ?? null);
  const [hiddenCols, setHiddenCols] = useSessionState<string[]>(`dt:${id}:hidden`, columns.filter((c) => c.hidden).map((c) => c.key));
  const [q, setQ] = useSessionState(`dt:${id}:q`, '');
  const [page, setPage] = useState(0);
  const [size, setSize] = useSessionState(`dt:${id}:size`, pageSize);
  const [showCols, setShowCols] = useState(false);
  const visible = columns.filter((c) => !hiddenCols.includes(c.key));

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      const hay = columns.map((c) => (c.searchValue ? c.searchValue(r) : String(c.sortValue?.(r) ?? ''))).join(' ').toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, q, columns]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va === vb) return 0;
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [filtered, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const pg = Math.min(page, pages - 1);
  const slice = sorted.slice(pg * size, pg * size + size);
  const allOnPage = slice.length > 0 && slice.every((r) => selected?.has(rowKey(r)));

  const toggle = (k: string) => {
    if (!onSelectedChange || !selected) return;
    const s = new Set(selected);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    onSelectedChange(s);
  };

  return (
    <div>
      {(search || toolbar) && (
        <div className="toolbar">
          {search && <input aria-label="Filter table" placeholder="Filter…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ width: 200 }} />}
          {toolbar}
          <span className="grow" />
          {selectable && selected && selected.size > 0 && (
            <span className="muted">
              {selected.size} selected{' '}
              <button className="link" onClick={() => onSelectedChange?.(new Set())}>
                clear
              </button>
              {selected.size < sorted.length && (
                <button className="link" onClick={() => onSelectedChange?.(new Set(sorted.map(rowKey)))}>
                  select all {sorted.length}
                </button>
              )}
            </span>
          )}
          <span style={{ position: 'relative' }}>
            <button className="small" onClick={() => setShowCols((v) => !v)} aria-expanded={showCols}>
              Columns
            </button>
            {showCols && (
              <div className="colmenu" style={{ right: 0, top: '110%' }} onMouseLeave={() => setShowCols(false)}>
                {columns.map((c) => (
                  <label key={c.key}>
                    <input type="checkbox" checked={!hiddenCols.includes(c.key)} onChange={(e) => setHiddenCols(e.target.checked ? hiddenCols.filter((h) => h !== c.key) : [...hiddenCols, c.key])} />
                    {c.header}
                  </label>
                ))}
              </div>
            )}
          </span>
        </div>
      )}
      <div className={`table-wrap ${short ? 'short' : ''}`}>
        <table className="dt">
          <thead>
            <tr>
              {selectable && (
                <th style={{ width: 26 }}>
                  <input
                    type="checkbox"
                    aria-label="Select page"
                    checked={allOnPage}
                    onChange={() => {
                      const s = new Set(selected);
                      for (const r of slice) {
                        if (allOnPage) s.delete(rowKey(r));
                        else s.add(rowKey(r));
                      }
                      onSelectedChange?.(s);
                    }}
                  />
                </th>
              )}
              {visible.map((c) => (
                <th
                  key={c.key}
                  className={`${c.numeric ? 'num' : ''} ${c.sortValue ? 'sortable' : ''}`}
                  style={c.width ? { width: c.width } : undefined}
                  onClick={() => c.sortValue && setSort(sort?.key === c.key ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' })}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.header}
                  {sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              const k = rowKey(r);
              return (
                <tr key={k} className={`${onRowClick ? 'clickable' : ''} ${selected?.has(k) ? 'selected' : ''} ${rowClass?.(r) ?? ''}`} onClick={() => onRowClick?.(r)}>
                  {selectable && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label="Select row" checked={!!selected?.has(k)} onChange={() => toggle(k)} />
                    </td>
                  )}
                  {visible.map((c) => (
                    <td key={c.key} className={c.numeric ? 'num' : ''}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!slice.length && (
              <tr>
                <td colSpan={visible.length + (selectable ? 1 : 0)}>
                  <div className="empty">{emptyText ?? 'No records.'}</div>
                </td>
              </tr>
            )}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      <div className="pager">
        <span>
          {sorted.length.toLocaleString()} row{sorted.length === 1 ? '' : 's'}
          {sorted.length !== rows.length && ` (filtered from ${rows.length.toLocaleString()})`}
        </span>
        <span className="spacer" />
        <label>
          Rows{' '}
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} aria-label="Rows per page">
            {[25, 50, 100, 250, 500].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <button className="small" disabled={pg === 0} onClick={() => setPage(0)} aria-label="First page">
          «
        </button>
        <button className="small" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Previous page">
          ‹
        </button>
        <span>
          Page {pg + 1} / {pages}
        </span>
        <button className="small" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Next page">
          ›
        </button>
        <button className="small" disabled={pg >= pages - 1} onClick={() => setPage(pages - 1)} aria-label="Last page">
          »
        </button>
      </div>
    </div>
  );
}
