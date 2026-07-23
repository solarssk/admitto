import type { HTMLAttributes } from "react";

function initials(name = ""): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts.at(-1)![0]!).toUpperCase();
}

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  name?: string;
  src?: string | null;
  size?: AvatarSize;
}

export function Avatar({ name = "", src = null, size = "md", className, ...rest }: Readonly<AvatarProps>) {
  const cls = ["at-avatar", size !== "md" && `at-avatar--${size}`, className].filter(Boolean).join(" ");
  return (
    <span className={cls} title={name || undefined} {...rest}>
      {src ? <img src={src} alt={name} /> : initials(name)}
    </span>
  );
}
