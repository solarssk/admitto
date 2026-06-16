import { useState, type ReactNode } from "react";

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export interface TabsProps {
  tabs?: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (id: string) => void;
}

export function Tabs({ tabs = [], value, defaultValue, onChange }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue ?? tabs[0]?.id);
  const active = value !== undefined ? value : internal;
  const select = (id: string) => {
    if (value === undefined) setInternal(id);
    onChange?.(id);
  };
  return (
    <div className="at-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={["at-tab", active === t.id && "at-tab--active"].filter(Boolean).join(" ")}
          onClick={() => select(t.id)}
        >
          {t.icon && (
            <span style={{ marginRight: 6 }} aria-hidden="true">
              {t.icon}
            </span>
          )}
          {t.label}
          {t.count != null && (
            <span style={{ marginLeft: 6, color: "var(--text-muted)", fontWeight: 400 }}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
