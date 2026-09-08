import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, EmptyState, HintLabel, IconButton, Input, Select, Switch, useToast } from "@admitto/ui";
import {
  fetchNotificationSettings,
  saveNotificationSettings,
  testNotificationSettings,
} from "../api/client.js";
import type {
  NotificationSettingsResponse,
  NotificationSettingsTestResponse,
  NotificationWebhookKind,
  SaveNotificationSettingsBody,
} from "../api/types.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { NO_AUTOFILL_PROPS, SettingsFooter } from "./mailTransportFormParts.js";

const WEBHOOK_URL_HINT =
  "Team-wide destination for every notification type below (one URL per organisation - not per admin).";
const WEBHOOK_KIND_HINT = "Shapes the payload: Discord embed, Slack text block, or a plain JSON body.";
const EXTRA_RECIPIENTS_HINT =
  "Also emailed on every enabled notification type below, independent of any individual admin's personal opt-out.";
const TOGGLES_HINT =
  "Turning a type off only stops active delivery (email/webhook/in-app) - the underlying security event is still recorded either way.";

type NotificationsDraft = {
  webhookUrl: string;
  clearWebhookUrl: boolean;
  webhookKind: NotificationWebhookKind;
  extraEmailRecipients: string[];
  disabledTypes: string[];
};

function draftFrom(data: NotificationSettingsResponse): NotificationsDraft {
  return {
    webhookUrl: "",
    clearWebhookUrl: false,
    webhookKind: data.webhook.kind,
    extraEmailRecipients: [...data.extra_email_recipients],
    disabledTypes: [...data.disabled_types],
  };
}

function sameStringList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function isDirty(draft: NotificationsDraft, saved: NotificationsDraft): boolean {
  return (
    draft.webhookUrl !== "" ||
    draft.clearWebhookUrl !== saved.clearWebhookUrl ||
    draft.webhookKind !== saved.webhookKind ||
    !sameStringList(draft.extraEmailRecipients, saved.extraEmailRecipients) ||
    !sameStringList(draft.disabledTypes, saved.disabledTypes)
  );
}

function buildSaveBody(draft: NotificationsDraft, saved: NotificationsDraft): SaveNotificationSettingsBody {
  const body: SaveNotificationSettingsBody = {};
  if (draft.clearWebhookUrl) body.webhookUrl = "";
  else if (draft.webhookUrl.trim() !== "") body.webhookUrl = draft.webhookUrl.trim();
  if (draft.webhookKind !== saved.webhookKind) body.webhookKind = draft.webhookKind;
  if (!sameStringList(draft.extraEmailRecipients, saved.extraEmailRecipients)) {
    body.extraEmailRecipients = draft.extraEmailRecipients;
  }
  if (!sameStringList(draft.disabledTypes, saved.disabledTypes)) {
    body.disabledTypes = draft.disabledTypes;
  }
  return body;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function testResultLabel(result: { ok: boolean; error?: string } | undefined): string {
  if (!result) return "Not tested";
  if (result.ok) return "Sent";
  return result.error?.trim() || "Failed";
}

/**
 * Organisation Settings → Notifications (notifications-module-foundation plan, PR2).
 * Mirrors ExternalServicesPanel's shape (one secret + toggles, no dirty-secret round trip).
 */
export function NotificationsPanel() {
  const { addToast } = useToast();
  const [data, setData] = useState<NotificationSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const showLoading = useDelayedLoading(loading);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<NotificationSettingsTestResponse | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [emailInputError, setEmailInputError] = useState<string | null>(null);

  const [draft, setDraft] = useState<NotificationsDraft | null>(null);
  const savedRef = useRef<NotificationsDraft | null>(null);
  const validationErrorsRef = useRef<HTMLUListElement | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchNotificationSettings(signal);
      if (signal?.aborted) return;
      setData(res);
      const d = draftFrom(res);
      setDraft(d);
      savedRef.current = d;
      setTestResult(null);
    } catch (err) {
      if (signal?.aborted) return;
      setLoadError(operatorApiErrorMessage(err, "Could not load notification settings."));
      setData(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  if (showLoading && !data) {
    return (
      <Card title="Notifications">
        <p className="settings-card-intro">Loading…</p>
      </Card>
    );
  }

  if (loadError && !data) {
    return (
      <EmptyState
        title="Could not load notification settings"
        description={loadError}
        action={
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (!data || !draft) return null;

  const saved = savedRef.current!;
  const hasUnsavedChanges = isDirty(draft, saved);

  function handleReset() {
    setDraft({ ...savedRef.current! });
    setEmailInput("");
    setEmailInputError(null);
  }

  function handleAddEmail() {
    const value = emailInput.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      setEmailInputError("Enter a valid email address.");
      return;
    }
    setDraft((d) =>
      d && !d.extraEmailRecipients.includes(value)
        ? { ...d, extraEmailRecipients: [...d.extraEmailRecipients, value] }
        : d,
    );
    setEmailInput("");
    setEmailInputError(null);
  }

  function handleRemoveEmail(email: string) {
    setDraft((d) => (d ? { ...d, extraEmailRecipients: d.extraEmailRecipients.filter((e) => e !== email) } : d));
  }

  function toggleType(typeId: string, enabled: boolean) {
    setDraft((d) => {
      if (!d) return d;
      const disabledTypes = enabled
        ? d.disabledTypes.filter((id) => id !== typeId)
        : [...d.disabledTypes, typeId];
      return { ...d, disabledTypes };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body = buildSaveBody(draft!, saved);
      const result = await saveNotificationSettings(body);
      setData(result);
      const d = draftFrom(result);
      setDraft(d);
      savedRef.current = d;
      addToast("Notification settings saved.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save notification settings."), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testNotificationSettings();
      setTestResult(result);
      const anyOk = result.webhook.ok || result.email.ok || result.in_app.ok;
      addToast(
        anyOk ? "Test notification sent - check the results below." : "Test notification failed on every channel.",
        anyOk ? "success" : "error",
      );
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Could not send a test notification."), "error");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="settings-sections">
      <Card title="Team webhook">
        <div className="settings-card-stack">
          <p className="settings-card-intro">{WEBHOOK_URL_HINT}</p>
          <div className="mail-transport-section">
            <div className="at-field mail-secret-field">
              <span className="at-label">Webhook URL</span>
              <Input
                type="text"
                id="notifications-webhook-url"
                name="notifications-webhook-url"
                value={draft.webhookUrl}
                disabled={draft.clearWebhookUrl}
                placeholder={data.webhook.set ? "•••••••• set" : "Not set"}
                {...NO_AUTOFILL_PROPS}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, webhookUrl: e.target.value, clearWebhookUrl: false } : d))
                }
              />
              {data.webhook.set && (
                <label className="form-check" style={{ marginTop: "var(--space-2)" }}>
                  <input
                    type="checkbox"
                    id="notifications-webhook-clear"
                    name="notifications-webhook-clear"
                    checked={draft.clearWebhookUrl}
                    onChange={(e) =>
                      setDraft((d) =>
                        d
                          ? { ...d, clearWebhookUrl: e.target.checked, webhookUrl: e.target.checked ? "" : d.webhookUrl }
                          : d,
                      )
                    }
                  />
                  <span>Clear webhook URL</span>
                </label>
              )}
            </div>
            <div className="at-field">
              <span className="at-label">
                <HintLabel hint={WEBHOOK_KIND_HINT}>Payload format</HintLabel>
              </span>
              <Select
                id="notifications-webhook-kind"
                value={draft.webhookKind}
                onChange={(e) =>
                  setDraft((d) => (d ? { ...d, webhookKind: e.target.value as NotificationWebhookKind } : d))
                }
              >
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="generic">Generic JSON</option>
              </Select>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Extra email recipients">
        <div className="settings-card-stack">
          <p className="settings-card-intro">{EXTRA_RECIPIENTS_HINT}</p>
          <div className="mail-field-row">
            <Input
              type="email"
              id="notifications-extra-recipient-input"
              name="notifications-extra-recipient-input"
              value={emailInput}
              placeholder="ops@example.com"
              invalid={Boolean(emailInputError)}
              error={emailInputError ?? undefined}
              {...NO_AUTOFILL_PROPS}
              onChange={(e) => {
                setEmailInput(e.target.value);
                setEmailInputError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddEmail();
                }
              }}
            />
            <Button type="button" variant="secondary" onClick={handleAddEmail}>
              Add
            </Button>
          </div>
          {draft.extraEmailRecipients.length > 0 && (
            <div className="notifications-recipient-chips">
              {draft.extraEmailRecipients.map((email) => (
                <Badge key={email} variant="neutral">
                  {email}
                  <IconButton
                    label={`Remove ${email}`}
                    icon={<i className="ti ti-x" aria-hidden="true" />}
                    onClick={() => handleRemoveEmail(email)}
                  />
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="Notification types">
        <div className="settings-card-stack">
          <p className="settings-card-intro">{TOGGLES_HINT}</p>
          {data.notification_types.map((type) => (
            <div key={type.id} className="mail-field-row" style={{ justifyContent: "space-between" }}>
              <span>{type.label}</span>
              <Switch
                id={`notifications-type-${type.id}`}
                label={draft.disabledTypes.includes(type.id) ? "Off" : "On"}
                checked={!draft.disabledTypes.includes(type.id)}
                onChange={(e) => toggleType(type.id, e.target.checked)}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card title="Test notification">
        <div className="settings-card-stack">
          <p className="settings-card-intro">
            Sends a real test through every configured channel to your own account (webhook is
            team-wide, so it goes to the shared destination above). Uses the saved settings, not
            unsaved changes.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={testing || hasUnsavedChanges}
            onClick={() => void handleTest()}
            icon={<i className="ti ti-send" aria-hidden="true" />}
          >
            {testing ? "Sending…" : "Send test"}
          </Button>
          {hasUnsavedChanges && <p className="at-hint">Save your changes before testing.</p>}
          {testResult && (
            <ul className="notifications-test-results">
              <li>Webhook: {testResultLabel(testResult.webhook)}</li>
              <li>Email: {testResultLabel(testResult.email)}</li>
              <li>In-app: {testResultLabel(testResult.in_app)}</li>
            </ul>
          )}
        </div>
      </Card>

      <SettingsFooter
        validationErrorsRef={validationErrorsRef}
        hasUnsavedChanges={hasUnsavedChanges}
        saving={saving}
        onReset={handleReset}
        onSave={() => void handleSave()}
      />
    </div>
  );
}
