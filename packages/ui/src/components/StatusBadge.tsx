import type { HTMLAttributes } from "react";
import { resolveStatusMeta } from "../status-map.js";
import { Badge } from "./Badge.js";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: string;
  label?: string;
  dot?: boolean;
}

export function StatusBadge({ status, label, dot, ...rest }: Readonly<StatusBadgeProps>) {
  const meta = resolveStatusMeta(status);
  return (
    <Badge variant={meta.variant} dot={dot ?? meta.dot} {...rest}>
      {label ?? meta.label}
    </Badge>
  );
}
