import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, EmptyState, HintLabel, Switch, Tooltip, useToast } from "@admitto/ui";
import { isBadgeItemUsable } from "@admitto/tickets/event-item-usability";
import { ApiError, fetchEventItems, fetchOpsConfig, updateOpsConfig } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { OpsConfigDto } from "../api/types.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { SettingsFooter } from "./mailTransportFormParts.js";

const CHECK_IN_BEHAVIOUR_HINT =
  "Controls how the check-in screen behaves for operators: confirmation prompts, manual lookup, and what happens automatically after a valid scan.";
const BADGE_INACTIVE_TOOLTIP =
  "Can't enable this. The badge item is disabled or has \"Issue on check-in\" turned off.";

type OpsConfigField = keyof OpsConfigDto;

function diffOpsConfig(draft: OpsConfigDto, saved: OpsConfigDto): Partial<OpsConfigDto> {
  const patch: Partial<OpsConfigDto> = {};
  for (const key of Object.keys(draft) as OpsConfigField[]) {
    if (draft[key] !== saved[key]) patch[key] = draft[key];
  }
  return patch;
}

/** Check-in behaviour tab: how the operator check-in screen behaves (badge issuance, scan
 * confirmation, manual lookup, auto-advance). Own load/save/SettingsFooter - like Location/Mail/
 * Ticket types, not part of the shared General-tab `form`, since it patches the separate
 * `Event.ops_config` endpoint rather than the main event-settings patch. */
export function CheckInBehaviourPanel({
  eventId,
  isArchived,
  onDirtyChange,
  onSavingChange,
}: Readonly<{
  eventId: string;
  isArchived: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}>) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState<OpsConfigDto | null>(null);
  const [savedDraft, setSavedDraft] = useState<OpsConfigDto | null>(null);
  const [badgeInactive, setBadgeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const loadAbortRef = useRef<AbortController | null>(null);
  const showLoading = useDelayedLoading(loading);

  const load = useCallback(async () => {
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    setLoading(true);
    setLoadError(null);
    try {
      const [ops, items] = await Promise.all([
        fetchOpsConfig(eventId, ac.signal),
        fetchEventItems(eventId, ac.signal),
      ]);
      if (ac.signal.aborted) return;
      setDraft(ops);
      setSavedDraft(ops);
      const badgeItem = items.find((i) => i.key === "badge");
      setBadgeInactive(!badgeItem || !isBadgeItemUsable(badgeItem.enabled, badgeItem.config));
    } catch {
      if (ac.signal.aborted) return;
      setLoadError("Could not load check-in behaviour.");
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  const patch = draft && savedDraft ? diffOpsConfig(draft, savedDraft) : null;
  const dirty = !!patch && Object.keys(patch).length > 0;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onSavingChange?.(saving);
  }, [saving, onSavingChange]);

  function setField(field: OpsConfigField, value: boolean) {
    setDraft((prev) => prev && { ...prev, [field]: value });
  }

  function handleReset() {
    setDraft(savedDraft);
  }

  async function handleSave() {
    if (!patch || Object.keys(patch).length === 0) return;
    setSaving(true);
    try {
      const updated = await updateOpsConfig(eventId, patch);
      setDraft(updated);
      setSavedDraft(updated);
      addToast("Check-in behaviour saved.", "success");
    } catch (err) {
      // The badge item can be disabled concurrently (another tab/admin) between this panel's
      // own load and Save — the client-side `badgeInactive` guard on the switch is stale in
      // that window, so the server's own check is the source of truth.
      if (err instanceof ApiError && err.status === 409 && hasApiErrorCode(err, "badge_item_inactive")) {
        setBadgeInactive(true);
        setDraft((prev) => prev && savedDraft && { ...prev, badge_at_entry: savedDraft.badge_at_entry });
        addToast(BADGE_INACTIVE_TOOLTIP, "warning");
      } else {
        addToast(operatorApiErrorMessage(err, "Failed to save check-in behaviour."), "error");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <EmptyState
        title="Could not load check-in behaviour"
        description={loadError}
        action={
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!draft) {
    return showLoading ? <p>Loading…</p> : null;
  }

  return (
    <div className="settings-sections">
      <Card title={<HintLabel hint={CHECK_IN_BEHAVIOUR_HINT}>Check-in behaviour</HintLabel>}>
        {isArchived && (
          <p className="field-hint event-settings-archived-note">
            This event is archived - check-in behaviour cannot be changed.
          </p>
        )}
        <div className="settings-row">
          <div className="settings-row__text">
            <strong>Issue badge at entry</strong>
            <p>
              Automatically issues the badge item when an attendee is admitted. The badge item
              must exist, be active, and have "Issue on check-in" turned on.
            </p>
          </div>
          <Tooltip content={!isArchived && badgeInactive ? BADGE_INACTIVE_TOOLTIP : undefined}>
            <Switch
              checked={draft.badge_at_entry}
              disabled={isArchived || saving || badgeInactive}
              onChange={(e) => setField("badge_at_entry", e.target.checked)}
              aria-label="Issue badge at entry"
            />
          </Tooltip>
        </div>
        <div className="settings-row">
          <div className="settings-row__text">
            <strong>Require confirmation on scan</strong>
            <p>Scan shows a preview; operator must confirm before check-in is recorded.</p>
          </div>
          <Switch
            checked={draft.require_confirm_on_scan}
            disabled={isArchived || saving}
            onChange={(e) => setField("require_confirm_on_scan", e.target.checked)}
            aria-label="Require confirmation on scan"
          />
        </div>
        <div className="settings-row">
          <div className="settings-row__text">
            <strong>Allow manual lookup</strong>
            <p>
              When off, operators can only check in by scanning a QR code. Searching by name or
              partial text is blocked on the check-in screen (the admin Attendees page is
              unaffected).
            </p>
          </div>
          <Switch
            checked={draft.allow_manual_lookup}
            disabled={isArchived || saving}
            onChange={(e) => setField("allow_manual_lookup", e.target.checked)}
            aria-label="Allow manual lookup"
          />
        </div>
        <div className="settings-row">
          <div className="settings-row__text">
            <strong>Auto-advance after valid check-in</strong>
            <p>
              After a valid scan, the check-in screen clears automatically for the next
              attendee, without tapping Next.
            </p>
          </div>
          <Switch
            checked={draft.auto_advance_on_valid}
            disabled={isArchived || saving}
            onChange={(e) => setField("auto_advance_on_valid", e.target.checked)}
            aria-label="Auto-advance on valid scan"
          />
        </div>
      </Card>
      {!isArchived && (
        <SettingsFooter
          hasUnsavedChanges={dirty}
          saving={saving}
          onReset={handleReset}
          onSave={() => void handleSave()}
        />
      )}
    </div>
  );
}
