export type EventOpsConfig = {
  require_confirm_on_scan: boolean;
  badge_at_entry: boolean;
  allow_manual_lookup: boolean;
  auto_advance_on_valid: boolean;
};

const DEFAULT_OPS_CONFIG: EventOpsConfig = {
  require_confirm_on_scan: false,
  badge_at_entry: true,
  allow_manual_lookup: true,
  auto_advance_on_valid: true,
};

export function parseEventOpsConfig(raw: unknown): EventOpsConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_OPS_CONFIG };
  const o = raw as Record<string, unknown>;
  return {
    require_confirm_on_scan: o.require_confirm_on_scan === true,
    badge_at_entry: o.badge_at_entry !== false,
    allow_manual_lookup: o.allow_manual_lookup !== false,
    auto_advance_on_valid: o.auto_advance_on_valid !== false,
  };
}
