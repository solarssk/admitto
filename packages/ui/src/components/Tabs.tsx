import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

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

  useEffect(() => {
    if (value !== undefined || tabs.length === 0) return;
    if (!tabs.some((tab) => tab.id === internal)) {
      setInternal(tabs[0]!.id);
    }
  }, [tabs, value, internal]);

  const fallbackActive = tabs.some((tab) => tab.id === internal) ? internal : (tabs[0]?.id ?? internal);
  const active = value !== undefined ? value : fallbackActive;

  const select = useCallback(
    (id: string) => {
      if (value === undefined) setInternal(id);
      onChange?.(id);
    },
    [onChange, value],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (tabs.length === 0) return;
    let nextIndex = index;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    select(tabs[nextIndex]!.id);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  };

  return (
    <div className="at-tabs" role="tablist">
      {tabs.map((t, index) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          tabIndex={active === t.id ? 0 : -1}
          className={["at-tab", active === t.id && "at-tab--active"].filter(Boolean).join(" ")}
          onClick={() => select(t.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
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
