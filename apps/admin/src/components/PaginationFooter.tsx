import { Button } from "@admitto/ui";

export type PaginationFooterProps = {
  idPrefix: string;
  page: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
  pageSizeOptions: readonly number[];
  onPageSizeChange: (pageSize: number) => void;
  onPrevious: () => void;
  onNext: () => void;
};

/** Shared "Showing X–Y of Z" + rows-per-page + Previous/Page N of M/Next footer, used by every
 * paginated table/card list in the admin SPA (Logs & Audit, Event archiving). */
export function PaginationFooter({
  idPrefix,
  page,
  pageSize,
  totalPages,
  totalRows,
  pageSizeOptions,
  onPageSizeChange,
  onPrevious,
  onNext,
}: Readonly<PaginationFooterProps>) {
  return (
    <div className="audit-log-footer">
      <div className="audit-log-footer__summary">
        <span className="audit-log-footer__info">
          {`Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, totalRows)} of ${totalRows}`}
        </span>
        <div className="audit-log-pagesize">
          <label htmlFor={`${idPrefix}-pagesize-select`}>Rows per page</label>
          <select
            id={`${idPrefix}-pagesize-select`}
            name={`${idPrefix}-pagesize-select`}
            className="at-select audit-log-pagesize-select"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="audit-log-footer__pager">
        <Button type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={onPrevious}>
          Previous
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button type="button" variant="secondary" size="sm" disabled={page >= totalPages} onClick={onNext}>
          Next
        </Button>
      </div>
    </div>
  );
}
