import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, useToast } from "@admitto/ui";
import { fetchSecuritySettings, patchSecuritySettings } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { PatchSystemSettingsBody, SystemSettingsDto, SettingSource } from "../api/types.js";

function fieldLocked(source: SettingSource): boolean {
  return source === "env";
}

function EnvBadge({ source }: Readonly<{ source: SettingSource }>) {
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
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

/** Settings panel — public instance URL for ticket links and absolute logo URLs in email. */
export function InstanceUrlPanel() {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<SystemSettingsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSecuritySettings();
      setSettings(data);
      setDraft(data.instance_url.value ?? "");
    } catch (err) {
      const message = operatorApiErrorMessage(err, "Failed to load instance settings.");
      setError(message);
      addToast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

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

    const trimmed = draft.trim();
    const current = settings.instance_url.value?.trim() ?? "";

    if (fieldLocked(settings.instance_url.source)) {
      addToast("No changes to save.", "info");
      setSaving(false);
      return;
    }

    if (trimmed === current) {
      addToast("No changes to save.", "info");
      setSaving(false);
      return;
    }

    if (trimmed && !isValidInstanceUrl(trimmed)) {
      addToast(
        "Instance URL must use https://, must not end with a trailing slash, and must not include credentials, a query, or a fragment.",
        "error",
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
      addToast("Settings saved.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to save settings."), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!settings || fieldLocked(settings.instance_url.source)) return;
    setSaving(true);

    try {
      const updated = await patchSecuritySettings({ instance_url: null });
      setSettings(updated);
      setDraft("");
      addToast("Reset to default.", "success");
    } catch (err) {
      addToast(operatorApiErrorMessage(err, "Failed to reset settings."), "error");
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

      </div>
    </Card>
  );
}
