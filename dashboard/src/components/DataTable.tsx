import { ReactNode } from 'react';

export interface Column<T = Record<string, unknown>> {
  key: string;
  label: string;
  render?: (value: unknown, row: T) => ReactNode;
  sortable?: boolean;
  width?: string;
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  pagination?: PaginationProps;
  emptyMessage?: string;
  rowKey?: keyof T | ((row: T) => string);
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <div className="skeleton skeleton-text" />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading = false,
  pagination,
  emptyMessage = 'No data found.',
  rowKey,
}: DataTableProps<T>) {
  function getRowKey(row: T, index: number): string {
    if (!rowKey) return String(index);
    if (typeof rowKey === 'function') return rowKey(row);
    return String(row[rowKey]);
  }

  return (
    <div className="data-table-wrapper">
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <SkeletonRow key={i} cols={columns.length} />
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="table-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row, index) => (
                <tr key={getRowKey(row, index)}>
                  {columns.map((col, i) => (
                    <td key={`${col.key}-${i}`}>
                      {col.render
                        ? col.render(row[col.key], row)
                        : (row[col.key] as ReactNode)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="table-pagination">
          <button
            className="btn btn-default btn-sm"
            onClick={() => pagination.onPageChange(pagination.page - 1)}
            disabled={pagination.page <= 1}
          >
            Previous
          </button>
          <span className="pagination-info">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <button
            className="btn btn-default btn-sm"
            onClick={() => pagination.onPageChange(pagination.page + 1)}
            disabled={pagination.page >= pagination.totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
