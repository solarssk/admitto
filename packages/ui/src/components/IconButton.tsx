import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonSize = "sm" | "md";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  size?: IconButtonSize;
}

export function IconButton({ icon, size = "md", label, className, ...rest }: Readonly<IconButtonProps>) {
  const cls = ["at-iconbtn", size !== "md" && `at-iconbtn--${size}`, className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} aria-label={label} {...rest}>
      {icon}
    </button>
  );
}
