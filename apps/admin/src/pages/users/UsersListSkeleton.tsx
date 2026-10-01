import type { ReactNode } from "react";
import { Card, Skeleton } from "@admitto/ui";
import { SLOW_NOTICE_TEXT } from "../../utils/loading-timing.js";
import "../users-page.css";

export interface SkeletonColumn {
  id: string;
  label: ReactNode;
  className?: string;
}

interface UsersListSkeletonProps {
  /** What is loading ("Loading users"): the region's accessible name. The shapes are decoration. */
  label: string;
  /** Not painted yet (the 200ms before a placeholder shows): the space is in the page, nothing is drawn. */
  held: boolean;
  /** After 8 seconds the region says it is taking longer than usual. */
  slow: boolean;
  /** The real column headings, so they do not flicker when the rows arrive. */
  columns: ReadonlyArray<SkeletonColumn>;
  rows: number;
  /** The height of the bar in a row, so a row is about as tall as a real one. */
  rowHeight: number;
  cards: number;
  cardHeight: number;
}

/**
 * A list of the Users page while it loads: the table (with the real column headings) and the stacked cards, one
 * of them shown by the same media query as the real list (`users-page__table-wrap--desktop` and
 * `users-page__cards--mobile`), in a status region named after what is loading. The heights are those of a real
 * row and a real card, so the list that replaces it does not move what is below it.
 */
export function UsersListSkeleton({ label, held, slow, columns, rows, rowHeight, cards, cardHeight }: Readonly<UsersListSkeletonProps>) {
  return (
    <output aria-label={label} className={held ? "users-page__skeleton at-loading-hold" : "users-page__skeleton"}>
      <div className="users-page__table-wrap users-page__table-wrap--desktop" aria-hidden="true">
        <table className="table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} className={column.className}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i}>
                <td colSpan={columns.length}>
                  <Skeleton variant="rect" height={rowHeight} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="users-page__cards users-page__cards--mobile" aria-hidden="true">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} variant="rect" height={cardHeight} className="users-page__card-skeleton" />
        ))}
      </div>
      {slow ? (
        <span className="at-hint" style={{ display: "block", textAlign: "center", color: "var(--text-secondary)" }}>
          {SLOW_NOTICE_TEXT}
        </span>
      ) : null}
    </output>
  );
}

/** The four KPI tiles at the top of the page while their numbers load: the icon square and three lines each, at the tile's real height. */
export function UsersStatsSkeleton({ held }: Readonly<{ held: boolean }>) {
  return (
    <div className={held ? "users-page__stats at-loading-hold" : "users-page__stats"} aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i} className="users-page__stat-card">
          <div className="users-page__stat">
            <Skeleton variant="rect" width={44} height={44} />
            <div className="users-page__stat-body">
              <Skeleton variant="rect" width={48} height={26} />
              <Skeleton variant="rect" width="70%" height={13} className="users-page__stat-skeleton-line" />
              <Skeleton variant="rect" width="55%" height={12} className="users-page__stat-skeleton-line" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
