import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@admitto/ui";
import { ApiError, fetchSecuritySettings, patchSecuritySettings } from "../api/client.js";
import type { PatchSystemSettingsBody, SystemSettingsDto, SettingSource } from "../api/types.js";

function fieldLocked(source: SettingSource): boolean {
  return source === "env";
}

function EnvBadge({ source }: { source: SettingSource }) {
  if (!fieldLocked(source)) return null;
  return (
    <Badge variant="neutral" className="mail-field-env-badge">
      Managed by environment
    </Badge>
  );
}

function isValidInstanceUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("https://")) return false;
  if (trimmed.endsWith("/")) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.search || parsed.hash) return false;
    return true;
  } catch {
    return false;
  }
}

/** Settings panel — public instance URL for ticket links and absolute logo URLs in email. */
export function InstanceUrlPanel() {
  const [settings, setSettings] = useState<SystemSettingsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSecuritySettings();
      setSettings(data);
      setDraft(data.instance_url.value ?? "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load instance settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasConfiguredUrl = Boolean(settings?.instance_url.value?.trim());

  const showWarning =
    settings &&
    !fieldLocked(settings.instance_url.source) &&
    !hasConfiguredUrl;

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setSaveError(null);
    setSaveStatus(null);

    const trimmed = draft.trim();
    const current = settings.instance_url.value?.trim() ?? "";

    if (fieldLocked(settings.instance_url.source)) {
      setSaveStatus("No changes to save.");
      setSaving(false);
      return;
    }

    if (trimmed === current) {
      setSaveStatus("No changes to save.");
      setSaving(false);
      return;
    }

    if (trimmed && !isValidInstanceUrl(trimmed)) {
      setSaveError(
        "Instance URL must use https://, must not end with a trailing slash, and must not include a query or fragment.",
      );
      setSaving(false);
      return;
    }

    const body: PatchSystemSettingsBody = {
      instance_url: trimmed.length > 0 ? trimmed : null,
    };

    try {
      const updated = await patchSecuritySettings(body);
      setSettings(updated);
      setDraft(updated.instance_url.value ?? "");
      setSaveStatus("Settings saved.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!settings || fieldLocked(settings.instance_url.source)) return;
    setSaving(true);
    setSaveError(null);
    setSaveStatus(null);

    try {
      const updated = await patchSecuritySettings({ instance_url: null });
      setSettings(updated);
      setDraft("");
      setSaveStatus("Reset to default.");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Failed to reset settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card title="Instance URL">
        <p className="sessions-status">Loading…</p>
      </Card>
    );
  }

  if (error || !settings) {
    return (
      <Card title="Instance URL">
        <div className="sessions-status">
          <p>{error ?? "Unexpected error."}</p>
          <Button type="button" variant="secondary" onClick={load}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Instance URL"
      footer={
        !fieldLocked(settings.instance_url.source) ? (
          <div className="mail-transport-footer">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => void handleReset()}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mail-transport-section">
        <div className="mail-field-row">
          <Input
            label="Instance URL"
            type="url"
            value={draft}
            disabled={fieldLocked(settings.instance_url.source)}
            placeholder="https://tickets.example.com"
            onChange={(e) => {
              setDraft(e.target.value);
              setSaveStatus(null);
            }}
          />
          <EnvBadge source={settings.instance_url.source} />
          <p className="mail-field-hint">
            Public HTTPS URL of this Admitto instance. Used for ticket links and to turn uploaded
            logo paths into absolute URLs in outbound email when the BASE_URL environment variable is
            not set.
          </p>
        </div>

        {hasConfiguredUrl && (
          <p role="status" className="text-success">
            Instance URL is configured
            {settings.instance_url.source === "env" ? " via environment" : ""}.
          </p>
        )}

        {showWarning && (
          <p role="alert" className="text-warning">
            No instance URL configured. Email previews and sends may use localhost in development,
            or fail in production until you set this value or BASE_URL in the environment.
          </p>
        )}

        {saveError && (
          <p role="alert" className="text-error">
            {saveError}
          </p>
        )}
        {saveStatus && !saveError && (
          <p role="status" className="text-success">
            {saveStatus}
          </p>
        )}
      </div>
    </Card>
  );
}
