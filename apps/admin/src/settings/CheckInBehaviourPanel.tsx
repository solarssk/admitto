import { useEffect, useState } from "react";
import { Card, HintLabel, Switch, Tooltip, useToast } from "@admitto/ui";
import { isBadgeItemUsable } from "@admitto/tickets/event-item-usability";
import { ApiError, fetchEventItems, fetchOpsConfig, updateOpsConfig } from "../api/client.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { OpsConfigDto } from "../api/types.js";
import { usePanelLoad } from "../hooks/usePanelLoad.js";
import { SettingsFooter } from "./mailTransportFormParts.js";
import { PanelLoadError } from "./PanelLoadError.js";
import { SettingsPanelSkeleton, type SettingsSkeletonCard } from "./SettingsPanelSkeleton.js";

const CHECK_IN_BEHAVIOUR_HINT =
  "Controls how the check-in screen behaves for operators: confirmation prompts, manual lookup, and what happens automatically after a valid scan.";
const BADGE_INACTIVE_TOOLTIP =
  "Can't enable this. The badge item is disabled or has \"Issue on check-in\" turned off.";

/** The card of the panel's placeholder: four switch rows (a title and a two-line description each). */
export const CHECKIN_BEHAVIOUR_SKELETON_CARDS: ReadonlyArray<SettingsSkeletonCard> = [
  { id: "behaviour", title: "Check-in behaviour", rows: 4, rowHeight: 64 },
];

type OpsConfigField = keyof OpsConfigDto;

function diffOpsConfig(draft: OpsConfigDto, saved: OpsConfigDto): Partial<OpsConfigDto> {
  const patch: Partial<OpsConfigDto> = {};
  for (const key of Object.keys(draft) as OpsConfigField[]) {
    if (draft[key] !== saved[key]) patch[key] = draft[key];
  }
  return patch;
}

interface CheckInBehaviourPanelProps {
  eventId: string;
  isArchived: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}

/** Check-in behaviour tab: how the operator check-in screen behaves (badge issuance, scan
 * confirmation, manual lookup, auto-advance). Own load/save/SettingsFooter - like Location/Mail/
 * Ticket types, not part of the shared General-tab `form`, since it patches the separate
 * `Event.ops_config` endpoint rather than the main event-settings patch.
 *
 * One event, one panel: a different `eventId` is a fresh panel (its own load and draft), never the previous event's
 * switches with new data under them. */
export function CheckInBehaviourPanel(props: Readonly<CheckInBehaviourPanelProps>) {
  return <CheckInBehaviourPanelBody key={props.eventId} {...props} />;
}

function CheckInBehaviourPanelBody({ eventId, isArchived, onDirtyChange, onSavingChange }: Readonly<CheckInBehaviourPanelProps>) {
  const { addToast } = useToast();
  const [draft, setDraft] = useState<OpsConfigDto | null>(null);
  const [savedDraft, setSavedDraft] = useState<OpsConfigDto | null>(null);
  const [badgeInactive, setBadgeInactive] = useState(false);
  const [saving, setSaving] = useState(false);

  // The first load: nothing is drawn for 200ms, then the card's own placeholder, an error with a busy Retry after a
  // failure (or 30 seconds without an answer). The switches and the badge item are read together.
  const panel = usePanelLoad({
    fetch: (signal) => Promise.all([fetchOpsConfig(eventId, signal), fetchEventItems(eventId, signal)]),
    apply: ([ops, items]) => {
      setDraft(ops);
      setSavedDraft(ops);
      const badgeItem = items.find((i) => i.key === "badge");
      setBadgeInactive(!badgeItem || !isBadgeItemUsable(badgeItem.enabled, badgeItem.config));
    },
    fallback: "Could not load check-in behaviour.",
  });

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

  if (!panel.gate.showContent) {
    return (
      <SettingsPanelSkeleton
        label="Loading check-in behaviour"
        held={!panel.gate.showIndicator}
        slow={panel.slow}
        cards={CHECKIN_BEHAVIOUR_SKELETON_CARDS}
      />
    );
  }

  // A successful load always fills the draft; a failure is `panel.error`.
  if (panel.error || !draft) {
    return (
      <PanelLoadError
        cardTitle={<HintLabel hint={CHECK_IN_BEHAVIOUR_HINT}>Check-in behaviour</HintLabel>}
        title="Could not load check-in behaviour"
        message={panel.error ?? "Unexpected error."}
        retrying={panel.retrying}
        onRetry={panel.retry}
      />
    );
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
