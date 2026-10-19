import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DataTable } from '../../src/ui/components/DataTable';
import { DecimalInput } from '../../src/ui/components/ui';
import { useState } from 'react';

type Row = { id: string; name: string; amount: number };
const rows: Row[] = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, name: `Item ${String(i).padStart(3, '0')}`, amount: (i * 37) % 101 }));

describe('DataTable', () => {
  const cols = [
    { key: 'name', header: 'Name', render: (r: Row) => r.name, sortValue: (r: Row) => r.name },
    { key: 'amount', header: 'Amount', numeric: true, render: (r: Row) => r.amount, sortValue: (r: Row) => r.amount }
  ];
  it('paginates, sorts and filters', () => {
    sessionStorage.clear();
    render(<DataTable id="t1" rows={rows} columns={cols} rowKey={(r) => r.id} pageSize={25} />);
    expect(screen.getByText('120 rows')).toBeInTheDocument();
    expect(screen.getByText('Page 1 / 5')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Amount'));
    fireEvent.click(screen.getByText(/^Amount/)); // descending
    const firstCell = screen.getAllByRole('row')[1];
    expect(within(firstCell).getByText('100')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(screen.getByText('Page 2 / 5')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filter table'), { target: { value: 'Item 007' } });
    expect(screen.getByText('1 row (filtered from 120)')).toBeInTheDocument();
  });
  it('supports row selection across the page', () => {
    sessionStorage.clear();
    function Harness() {
      const [sel, setSel] = useState<Set<string>>(new Set());
      return (
        <>
          <span data-testid="count">{sel.size}</span>
          <DataTable id="t2" rows={rows} columns={cols} rowKey={(r) => r.id} pageSize={25} selectable selected={sel} onSelectedChange={setSel} />
        </>
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Select page'));
    expect(screen.getByTestId('count').textContent).toBe('25');
    fireEvent.click(screen.getByText('select all 120'));
    expect(screen.getByTestId('count').textContent).toBe('120');
  });
});

describe('DecimalInput', () => {
  it('keeps values as decimal strings and rejects invalid input', () => {
    let last: string | undefined = 'x';
    render(<DecimalInput label="Amount" value={undefined} onChange={(v) => (last = v)} />);
    const input = screen.getByLabelText('Amount');
    fireEvent.change(input, { target: { value: '0.1' } });
    expect(last).toBe('0.1');
    fireEvent.change(input, { target: { value: '12abc' } });
    expect(screen.getByText('Enter a non-negative number')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '-5' } });
    expect(last).toBe('0.1');
  });
});
