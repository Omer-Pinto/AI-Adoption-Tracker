import type { ReactNode } from 'react';

// Generic table matching the mvp/ .data-table look (used by artifacts, tasks,
// domain/team pages). Column-driven so Wave-2 agents just pass data + columns.

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** Cell renderer; receives the full row. */
  render: (row: Row) => ReactNode;
  width?: string;
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  onRowClick?: (row: Row) => void;
  empty?: ReactNode;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = 'Nothing here yet.',
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return <div className="page-body text-muted text-sm">{empty}</div>;
  }
  return (
    <table className="data-table">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} style={c.width ? { width: c.width } : undefined}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            style={onRowClick ? { cursor: 'pointer' } : undefined}
          >
            {columns.map((c) => (
              <td key={c.key}>{c.render(row)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
