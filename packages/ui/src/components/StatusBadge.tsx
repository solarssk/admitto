import type { HTMLAttributes } from "react";
import { resolveStatusMeta } from "../status-map.js";
import { Badge } from "./Badge.js";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: string;
  label?: string;
}

export function StatusBadge({ status, label, ...rest }: Readonly<StatusBadgeProps>) {
  const meta = resolveStatusMeta(status);
  return (
    <Badge variant={meta.variant} dot={meta.dot} {...rest}>
      {label ?? meta.label}
    </Badge>
  );
}
