/**
 * Shared between MailTransportPanel (organization-wide instance Settings) and
 * EventMailSettingsCard (per-event dedicated transport override, #511) — the tile
 * grid, secret field UI, provider-specific cards, test result preview, and footer
 * are identical between the two scopes; only what fetches/saves/tests differs.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Badge, Button, Card, HintLabel, Input, Switch, Tooltip } from "@admitto/ui";
import type {
  MailPlainFieldDto,
  MailProvider,
  MailSecretFieldDto,
  MailSettingsFieldsDto,
  MailTransportTestSendResponse,
} from "../api/types.js";
import { ApiError } from "../api/client.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { hasApiErrorCode, operatorApiErrorMessage } from "../api/operator-api-error.js";
import { emptyMailDraft, emptySecretEdits, type MailDraft, type SecretEdits } from "./mailSettingsValidation.js";
import { buildMailProviderOptions, MAIL_PROVIDER_LABELS } from "./mailProviderOptions.js";
import { formatUtcDateTime } from "../utils/event-dates.js";

/** Every field here (SMTP username/password, Graph/Power Automate secrets, and every
 * email-typed field below) is something the operator types once and reuses — never
 * their own account's email or password — so browser-vendor and extension autofill
 * (1Password, LastPass, Bitwarden, iCloud Hide My Email, etc.) only gets in the way:
 * wrong suggestions, and some extensions inject an overlay button that shifts layout.
 * These are the conventional opt-out signals each of those checks for. */
export const NO_AUTOFILL_PROPS = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

export interface TestResult {
  kind: "ok" | "error";
  message: string;
  recipient: string;
  provider?: MailProvider;
  providerMessageId?: string;
  retryable?: boolean;
  timestamp: string;
  /** Snapshotted at send time — the transport can be edited (unsaved) after a test
   * completes, and this result must keep describing what was actually tested. */
  host?: string;
  port?: string;
  mailbox?: string;
}

export type FieldLocked = (key: keyof MailSettingsFieldsDto) => boolean;

function strValue(fd: MailPlainFieldDto<string | null>): string {
  return fd.value ?? "";
}

function numValue(fd: MailPlainFieldDto<number | null>): string {
  return fd.value === null || fd.value === undefined ? "" : String(fd.value);
}

function boolValue(fd: MailPlainFieldDto<boolean | null>, fallback: boolean): boolean {
  return fd.value ?? fallback;
}

export function draftFromFields(f: MailSettingsFieldsDto): MailDraft {
  return {
    provider: f.provider.value ?? "",
    fromAddress: strValue(f.fromAddress),
    fromName: strValue(f.fromName),
    replyTo: strValue(f.replyTo),
    envelopeFrom: strValue(f.envelopeFrom),
    allowedFromDomain: strValue(f.allowedFromDomain),
    host: strValue(f.host),
    port: numValue(f.port),
    secure: boolValue(f.secure, false),
    user: strValue(f.user),
    requireTls: boolValue(f.requireTls, true),
    tlsRejectUnauthorized: boolValue(f.tlsRejectUnauthorized, true),
    heloName: strValue(f.heloName),
    pool: boolValue(f.pool, true),
    maxConnections: numValue(f.maxConnections),
    maxMessages: numValue(f.maxMessages),
    rateLimitPerMinute: numValue(f.rateLimitPerMinute),
    connectionTimeout: numValue(f.connectionTimeout),
    greetingTimeout: numValue(f.greetingTimeout),
    socketTimeout: numValue(f.socketTimeout),
    mailbox: strValue(f.mailbox),
    tenantId: strValue(f.tenantId),
    clientId: strValue(f.clientId),
    saveToSentItems: boolValue(f.saveToSentItems, true),
  };
}

export function EnvBadge({ locked }: Readonly<{ locked: boolean }>) {
  if (!locked) return null;
  return (
    <Badge variant="neutral" className="mail-field-env-badge">
      Managed by environment
    </Badge>
  );
}

const SENDER_HINT = "From, reply-to, and bounce addresses used on every email this sends.";
// Shared by MailTransportPanel (organization-wide) and EventMailSettingsCard (per-event) - both
// render their own "Send test email" card against the same underlying test-send flow.
export const SEND_TEST_EMAIL_HINT =
  "Sends a trivial message to confirm delivery — not an event ticket or reminder template.";

export const PROVIDER_GUIDE: Record<MailProvider | "", string> = {
  "": "No mail will be sent yet.",
  smtp: "External SMTP relay. Port 587 + STARTTLS, or 465 + implicit TLS.",
  graph: "Entra app-only Graph send (Mail.Send). Mailbox may differ from From.",
  powerautomate: "HTTP fallback when SMTP/Graph are unavailable.",
  export_only: "No network send. Message export only (non-production).",
};

const TRANSPORT_ICON: Record<MailProvider | "", string> = {
  "": "plug-off",
  smtp: "server-2",
  graph: "brand-office",
  powerautomate: "bolt",
  export_only: "file-export",
};

/** Builds the four SecretFieldRow callbacks for one secret key, routed through the
 * shared updateSecrets wrapper so every edit invalidates any stale test result. */
export function makeSecretHandlers(
  key: keyof SecretEdits,
  updateSecrets: (updater: (prev: SecretEdits) => SecretEdits) => void,
) {
  return {
    onReplace: () =>
      updateSecrets((s) => ({ ...s, [key]: { mode: "replace" as const, value: "" } })),
    onClear: () => updateSecrets((s) => ({ ...s, [key]: { mode: "clear" as const, value: "" } })),
    onValueChange: (value: string) =>
      updateSecrets((s) => ({ ...s, [key]: { mode: "replace" as const, value } })),
    onCancel: () => updateSecrets((s) => ({ ...s, [key]: { mode: "idle" as const, value: "" } })),
  };
}

export function SecretFieldRow({
  label,
  field,
  edit,
  onReplace,
  onClear,
  onValueChange,
  onCancel,
  disabled = false,
}: Readonly<{
  label: string;
  field: MailSecretFieldDto;
  edit: SecretEdits[keyof SecretEdits];
  onReplace: () => void;
  onClear: () => void;
  onValueChange: (value: string) => void;
  onCancel: () => void;
  /** Read-only override independent of `field.locked` (env-managed) — e.g. an archived
   * event's fields, where nothing is env-managed but edits still can't be saved. */
  disabled?: boolean;
}>) {
  const editing = edit.mode !== "idle";
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!editing) setConfirmed(false);
  }, [editing]);

  const canConfirm = edit.mode === "clear" || edit.value.trim().length > 0;

  return (
    <div className="mail-secret-field">
      <div className="at-field">
        <div className="mail-secret-field__label-row">
          <span className="at-label">{label}</span>
          {editing && !confirmed && (
            <span className="mail-secret-field__inline-hint">Saves when you select Save below.</span>
          )}
        </div>
        <div className="mail-secret-field__display">
          {editing && !confirmed && (
            <>
              <Input
                type="password"
                aria-label={label}
                {...NO_AUTOFILL_PROPS}
                className="mail-secret-field__input"
                placeholder={edit.mode === "clear" ? "Will be cleared on save" : "New value"}
                value={edit.value}
                disabled={edit.mode === "clear" || field.locked || disabled}
                onChange={(e) => onValueChange(e.target.value)}
              />
              <div className="mail-secret-field__display-actions">
                <button
                  type="button"
                  className="mail-secret-field__icon-btn mail-secret-field__icon-btn--confirm"
                  aria-label="Confirm"
                  disabled={!canConfirm}
                  onClick={() => setConfirmed(true)}
                >
                  <i className="ti ti-check" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="mail-secret-field__icon-btn mail-secret-field__icon-btn--cancel"
                  aria-label="Cancel"
                  onClick={onCancel}
                >
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              </div>
            </>
          )}
          {editing && confirmed && (
            <>
              <span className="mail-secret-field__display-value">
                <i className="ti ti-lock" aria-hidden="true" />
                {edit.mode === "clear" ? "Will be cleared" : "New value"}, pending save
              </span>
              <div className="mail-secret-field__display-actions">
                <button
                  type="button"
                  className="mail-secret-field__link"
                  onClick={() => setConfirmed(false)}
                >
                  Change
                </button>
              </div>
            </>
          )}
          {!editing && (
            <>
              <span className="mail-secret-field__display-value">
                <i className="ti ti-lock" aria-hidden="true" />
                {field.set ? "•••••••• set" : "Not set"}
              </span>
              {field.locked ? (
                <EnvBadge locked />
              ) : (
                <div className="mail-secret-field__display-actions">
                  <button
                    type="button"
                    className="mail-secret-field__link"
                    disabled={disabled}
                    onClick={onReplace}
                  >
                    {field.set ? "Change" : "Set"}
                  </button>
                  {field.set && (
                    <button
                      type="button"
                      className="mail-secret-field__link mail-secret-field__link--danger"
                      disabled={disabled}
                      onClick={onClear}
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const TRANSPORT_TILES = [{ value: "" as const, label: "Not configured" }] as const;

export function TransportTileGrid({
  provider,
  providerOptions,
  locked,
  onSelect,
  includeNotConfigured = true,
}: Readonly<{
  provider: MailProvider | "";
  providerOptions: ReturnType<typeof buildMailProviderOptions>;
  locked: boolean;
  onSelect: (value: MailProvider | "") => void;
  /** Event dedicated-mode omits the "Not configured" tile — choosing "Dedicated" already
   * implies picking a transport, so it isn't offered as one of the tiles there. */
  includeNotConfigured?: boolean;
}>) {
  const tiles = includeNotConfigured ? [...TRANSPORT_TILES, ...providerOptions] : providerOptions;
  // Dedicated mode starts with provider="" and omits "Not configured", so no tile is ever
  // active — without this fallback every tile gets tabIndex -1 and keyboard users can't
  // enter the group at all (CodeRabbit review).
  const hasActiveTile = tiles.some((tile) => tile.value === provider);
  const tileRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = (index: number) => {
    if (locked) return;
    const wrapped = (index + tiles.length) % tiles.length;
    onSelect(tiles[wrapped].value);
    tileRefs.current[wrapped]?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusAndSelect(index + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusAndSelect(index - 1);
    }
  };

  return (
    <div className="transport-grid" role="radiogroup" aria-label="Transport">
      {tiles.map((opt, index) => {
        const active = provider === opt.value;
        // The tile itself only has room for a short word or two — the parenthetical
        // qualifier ("(recommended)", "(dev/test)") moves to the hover tooltip instead of
        // getting truncated with an ellipsis. aria-label keeps the full text either way.
        // Plain indexOf/slice rather than a regex — SonarCloud flagged the equivalent
        // \s*\([^)]*\)\s*$ pattern as super-linear on adversarial input.
        const parenIndex = opt.label.indexOf("(");
        const shortLabel = parenIndex === -1 ? opt.label : opt.label.slice(0, parenIndex).trimEnd();
        return (
          <Tooltip
            key={opt.value || "none"}
            content={PROVIDER_GUIDE[opt.value]}
            className="transport-tile-wrapper"
          >
            <button
              ref={(el) => {
                tileRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={opt.label}
              tabIndex={active || (!hasActiveTile && index === 0) ? 0 : -1}
              className={`transport-tile${active ? " transport-tile--active" : ""}`}
              disabled={locked}
              onClick={() => onSelect(opt.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              <span className="transport-tile__icon">
                <i className={`ti ti-${TRANSPORT_ICON[opt.value]}`} aria-hidden="true" />
              </span>
              <strong>{shortLabel}</strong>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export function SenderCard({
  draft,
  fieldLocked,
  updateDraft,
  disabled = false,
}: Readonly<{
  draft: MailDraft;
  fieldLocked: FieldLocked;
  updateDraft: (patch: Partial<MailDraft>) => void;
  /** Read-only override independent of `fieldLocked` (env-managed) — e.g. an archived event. */
  disabled?: boolean;
}>) {
  const isDisabled: FieldLocked = (key) => fieldLocked(key) || disabled;
  return (
    <Card title={<HintLabel hint={SENDER_HINT}>Sender</HintLabel>}>
      <div className="mail-transport-section">
        <Input
          label="From address"
          type="text"
          inputMode="email"
          value={draft.fromAddress}
          disabled={isDisabled("fromAddress")}
          onChange={(e) => updateDraft({ fromAddress: e.target.value })}
          {...NO_AUTOFILL_PROPS}
        />
        <Input
          label="From name"
          value={draft.fromName}
          disabled={isDisabled("fromName")}
          onChange={(e) => updateDraft({ fromName: e.target.value })}
        />
        <Input
          label="Reply-to"
          type="text"
          inputMode="email"
          value={draft.replyTo}
          disabled={isDisabled("replyTo")}
          onChange={(e) => updateDraft({ replyTo: e.target.value })}
          {...NO_AUTOFILL_PROPS}
        />
        <Input
          label="Envelope from (bounce address)"
          type="text"
          inputMode="email"
          value={draft.envelopeFrom}
          disabled={isDisabled("envelopeFrom")}
          {...NO_AUTOFILL_PROPS}
          onChange={(e) => updateDraft({ envelopeFrom: e.target.value })}
          hint="SMTP MAIL FROM / return-path."
        />
        <Input
          label="Allowed from domain"
          value={draft.allowedFromDomain}
          disabled={isDisabled("allowedFromDomain")}
          onChange={(e) => updateDraft({ allowedFromDomain: e.target.value })}
          hint="Optional. Send fails when From (or Graph mailbox) is outside this domain."
        />
      </div>
    </Card>
  );
}

export function SmtpConnectionCard({
  draft,
  fieldLocked,
  updateDraft,
  smtpPasswordField,
  smtpPasswordEdit,
  updateSecrets,
  disabled = false,
}: Readonly<{
  draft: MailDraft;
  fieldLocked: FieldLocked;
  updateDraft: (patch: Partial<MailDraft>) => void;
  smtpPasswordField: MailSecretFieldDto;
  smtpPasswordEdit: SecretEdits[keyof SecretEdits];
  updateSecrets: (updater: (prev: SecretEdits) => SecretEdits) => void;
  /** Read-only override independent of `fieldLocked` (env-managed) — e.g. an archived event. */
  disabled?: boolean;
}>) {
  const isDisabled: FieldLocked = (key) => fieldLocked(key) || disabled;
  return (
    <Card title={<HintLabel hint={PROVIDER_GUIDE.smtp}>SMTP connection</HintLabel>}>
      <div className="mail-transport-form">
        <div className="mail-transport-section">
          <Input
            label="SMTP host"
            value={draft.host}
            disabled={isDisabled("host")}
            onChange={(e) => updateDraft({ host: e.target.value })}
            placeholder="smtp.example.com"
          />
          <Input
            label="Port"
            inputMode="numeric"
            value={draft.port}
            disabled={isDisabled("port")}
            onChange={(e) => updateDraft({ port: e.target.value })}
            placeholder="587"
          />
          <Input
            label="Username"
            value={draft.user}
            disabled={isDisabled("user")}
            onChange={(e) => updateDraft({ user: e.target.value })}
            {...NO_AUTOFILL_PROPS}
          />
          <SecretFieldRow
            label="Password"
            field={smtpPasswordField}
            edit={smtpPasswordEdit}
            disabled={disabled}
            {...makeSecretHandlers("smtpPassword", updateSecrets)}
          />
          <div className="settings-row">
            <div className="settings-row__text">
              <strong>Use TLS (secure)</strong>
              <p>Implicit TLS on connect, typically port 465.</p>
            </div>
            <Switch
              aria-label="Use TLS (secure)"
              checked={draft.secure}
              disabled={isDisabled("secure")}
              onChange={(e) => updateDraft({ secure: e.target.checked })}
            />
          </div>
          <div className="settings-row">
            <div className="settings-row__text">
              <strong>Require STARTTLS</strong>
              <p>Upgrade a plaintext connection, typically port 587.</p>
            </div>
            <Switch
              aria-label="Require STARTTLS"
              checked={draft.requireTls}
              disabled={isDisabled("requireTls")}
              onChange={(e) => updateDraft({ requireTls: e.target.checked })}
            />
          </div>
        </div>

        <details className="disclosure">
          <summary className="disclosure__summary">
            <i className="ti ti-chevron-right" aria-hidden="true" /> Advanced tuning
          </summary>
          <div className="disclosure__body">
            <div className="mail-transport-section">
              <div className="mail-tuning__toggles">
                <Switch
                  label="Connection pool"
                  checked={draft.pool}
                  disabled={isDisabled("pool")}
                  onChange={(e) => updateDraft({ pool: e.target.checked })}
                />
                <Switch
                  label="Verify TLS certificate"
                  checked={draft.tlsRejectUnauthorized}
                  disabled={isDisabled("tlsRejectUnauthorized")}
                  onChange={(e) => updateDraft({ tlsRejectUnauthorized: e.target.checked })}
                />
              </div>
              <div className="mail-field-row">
                <Input
                  label="HELO/EHLO name"
                  value={draft.heloName}
                  disabled={isDisabled("heloName")}
                  onChange={(e) => updateDraft({ heloName: e.target.value })}
                />
              </div>
              <div className="mail-tuning__limits">
                <Input
                  label="Rate limit (per minute)"
                  inputMode="numeric"
                  value={draft.rateLimitPerMinute}
                  disabled={isDisabled("rateLimitPerMinute")}
                  onChange={(e) => updateDraft({ rateLimitPerMinute: e.target.value })}
                />
                <Input
                  label="Max connections"
                  inputMode="numeric"
                  value={draft.maxConnections}
                  disabled={isDisabled("maxConnections")}
                  onChange={(e) => updateDraft({ maxConnections: e.target.value })}
                />
                <Input
                  label="Max messages per connection"
                  inputMode="numeric"
                  value={draft.maxMessages}
                  disabled={isDisabled("maxMessages")}
                  onChange={(e) => updateDraft({ maxMessages: e.target.value })}
                />
              </div>
              <div className="mail-tuning__timeouts">
                <Input
                  label="Connection timeout (ms)"
                  inputMode="numeric"
                  value={draft.connectionTimeout}
                  disabled={isDisabled("connectionTimeout")}
                  onChange={(e) => updateDraft({ connectionTimeout: e.target.value })}
                />
                <Input
                  label="Greeting timeout (ms)"
                  inputMode="numeric"
                  value={draft.greetingTimeout}
                  disabled={isDisabled("greetingTimeout")}
                  onChange={(e) => updateDraft({ greetingTimeout: e.target.value })}
                />
                <Input
                  label="Socket timeout (ms)"
                  inputMode="numeric"
                  value={draft.socketTimeout}
                  disabled={isDisabled("socketTimeout")}
                  onChange={(e) => updateDraft({ socketTimeout: e.target.value })}
                />
              </div>
            </div>
          </div>
        </details>
      </div>
    </Card>
  );
}

export function GraphCard({
  draft,
  fieldLocked,
  updateDraft,
  graphClientSecretField,
  graphClientSecretEdit,
  updateSecrets,
  disabled = false,
}: Readonly<{
  draft: MailDraft;
  fieldLocked: FieldLocked;
  updateDraft: (patch: Partial<MailDraft>) => void;
  graphClientSecretField: MailSecretFieldDto;
  graphClientSecretEdit: SecretEdits[keyof SecretEdits];
  updateSecrets: (updater: (prev: SecretEdits) => SecretEdits) => void;
  /** Read-only override independent of `fieldLocked` (env-managed) — e.g. an archived event. */
  disabled?: boolean;
}>) {
  const isDisabled: FieldLocked = (key) => fieldLocked(key) || disabled;
  return (
    <Card title={<HintLabel hint={PROVIDER_GUIDE.graph}>Microsoft Graph</HintLabel>}>
      <div className="mail-transport-form">
        <details className="mail-graph-setup-info">
          <summary>Entra app registration steps</summary>
          <ol>
            <li>Register an app in Entra ID (App registrations → New registration).</li>
            <li>
              API permissions → Microsoft Graph → <strong>Application permissions</strong> (not
              Delegated) → <code>Mail.Send</code>.
            </li>
            <li>
              Grant <strong>admin consent</strong> for the tenant.
            </li>
            <li>
              Create a <strong>client secret</strong> and copy the value immediately. It's shown
              once.
            </li>
            <li>
              Enter the sending mailbox's address into <strong>Mailbox</strong> below. It can
              differ from <strong>From address</strong> above.
            </li>
            <li>
              Paste <strong>Tenant ID</strong>, <strong>Client ID</strong>, and the secret into the
              fields below.
            </li>
          </ol>
          <p>
            This is app-only (client-credentials) authentication. Settings never opens an
            interactive Microsoft sign-in, and there's no consent screen to click through here; a
            tenant admin grants consent once, in Entra. After saving, use{" "}
            <strong>Send test</strong> below to confirm delivery.
          </p>
        </details>
        <div className="mail-transport-section">
          <Input
            label="Mailbox"
            type="text"
            inputMode="email"
            value={draft.mailbox}
            disabled={isDisabled("mailbox")}
            onChange={(e) => updateDraft({ mailbox: e.target.value })}
            placeholder="shared@contoso.com"
            {...NO_AUTOFILL_PROPS}
          />
          <Input
            label="Tenant ID"
            value={draft.tenantId}
            disabled={isDisabled("tenantId")}
            onChange={(e) => updateDraft({ tenantId: e.target.value })}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <Input
            label="Client ID"
            value={draft.clientId}
            disabled={isDisabled("clientId")}
            onChange={(e) => updateDraft({ clientId: e.target.value })}
            placeholder="00000000-0000-0000-0000-000000000000"
          />
          <SecretFieldRow
            label="Client secret"
            field={graphClientSecretField}
            edit={graphClientSecretEdit}
            disabled={disabled}
            {...makeSecretHandlers("graphClientSecret", updateSecrets)}
          />
          <Switch
            label="Save to Sent Items"
            checked={draft.saveToSentItems}
            disabled={isDisabled("saveToSentItems")}
            onChange={(e) => updateDraft({ saveToSentItems: e.target.checked })}
          />
        </div>
      </div>
    </Card>
  );
}

export function PowerAutomateCard({
  powerAutomateUrlField,
  powerAutomateUrlEdit,
  powerAutomateKeyField,
  powerAutomateKeyEdit,
  updateSecrets,
  disabled = false,
}: Readonly<{
  powerAutomateUrlField: MailSecretFieldDto;
  powerAutomateUrlEdit: SecretEdits[keyof SecretEdits];
  powerAutomateKeyField: MailSecretFieldDto;
  powerAutomateKeyEdit: SecretEdits[keyof SecretEdits];
  updateSecrets: (updater: (prev: SecretEdits) => SecretEdits) => void;
  /** Read-only override — e.g. an archived event. */
  disabled?: boolean;
}>) {
  return (
    <Card title={<HintLabel hint={PROVIDER_GUIDE.powerautomate}>Power Automate</HintLabel>}>
      <div className="mail-transport-section">
        <SecretFieldRow
          label="Flow URL"
          field={powerAutomateUrlField}
          edit={powerAutomateUrlEdit}
          disabled={disabled}
          {...makeSecretHandlers("powerAutomateUrl", updateSecrets)}
        />
        <SecretFieldRow
          label="Flow key"
          field={powerAutomateKeyField}
          edit={powerAutomateKeyEdit}
          disabled={disabled}
          {...makeSecretHandlers("powerAutomateKey", updateSecrets)}
        />
      </div>
    </Card>
  );
}

export function TestResultPreview({ testResult }: Readonly<{ testResult: TestResult }>) {
  const transportLabel = testResult.provider
    ? MAIL_PROVIDER_LABELS[testResult.provider]
    : "the configured transport";
  const heroText =
    testResult.kind === "ok" ? `Sent successfully via ${transportLabel}.` : testResult.message;

  return (
    <output className={`mail-preview mail-preview--${testResult.kind}`}>
      {testResult.kind === "ok" && (
        <div className="mail-preview__head">
          <b>✅ Your Admitto mail configuration is working</b>
          <span>to {testResult.recipient}</span>
        </div>
      )}
      <div className="test-mail-hero">
        <span className="test-mail-hero__icon">
          <i
            className={`ti ${testResult.kind === "ok" ? "ti-circle-check" : "ti-circle-x"}`}
            aria-hidden="true"
          />
        </span>
        <p>{heroText}</p>
      </div>
      <div className="test-mail-summary">
        <div>
          <span>Recipient</span>
          <b>{testResult.recipient}</b>
        </div>
        {testResult.provider && (
          <div>
            <span>Transport</span>
            <b>{MAIL_PROVIDER_LABELS[testResult.provider]}</b>
          </div>
        )}
        {testResult.provider === "smtp" && testResult.host && (
          <div>
            <span>Host</span>
            <b>
              {testResult.host}:{testResult.port}
            </b>
          </div>
        )}
        {testResult.provider === "graph" && testResult.mailbox && (
          <div>
            <span>Mailbox</span>
            <b>{testResult.mailbox}</b>
          </div>
        )}
        <div>
          <span>{testResult.kind === "ok" ? "Sent at" : "Attempted at"}</span>
          <b>{formatUtcDateTime(testResult.timestamp)}</b>
        </div>
        {testResult.providerMessageId && (
          <div>
            <span>Message ID</span>
            <b className="test-mail-summary__mono">{testResult.providerMessageId}</b>
          </div>
        )}
        {testResult.kind === "error" && testResult.retryable !== undefined && (
          <div>
            <span>Retryable</span>
            <b>{testResult.retryable ? "Yes" : "No"}</b>
          </div>
        )}
      </div>
      {testResult.kind === "ok" && (
        <p className="test-mail-footnote">Automated message from Admitto. No reply needed.</p>
      )}
    </output>
  );
}

/** Shared by MailTransportPanel (organization-wide) and EventMailSettingsCard (per-event) -
 * identical in both scopes except the disabled-reason element's id, which needs to be unique
 * when (in principle) both could render on the same page. */
export function SendTestEmailCard({
  idPrefix,
  testEmail,
  onTestEmailChange,
  testSendHint,
  testSendReason,
  testSending,
  onTestSend,
  testResult,
}: Readonly<{
  idPrefix: string;
  testEmail: string;
  onTestEmailChange: (value: string) => void;
  testSendHint: string;
  testSendReason: string | undefined;
  testSending: boolean;
  onTestSend: () => void;
  testResult: TestResult | null;
}>) {
  const reasonId = `${idPrefix}-reason`;
  return (
    <Card title={<HintLabel hint={SEND_TEST_EMAIL_HINT}>Send test email</HintLabel>}>
      <div className="settings-card-stack">
        <p className="mail-test-send__hint settings-card-intro">{testSendHint}</p>
        <div className="mail-test-send__row">
          <Input
            label="Recipient"
            type="text"
            inputMode="email"
            value={testEmail}
            onChange={(e) => onTestEmailChange(e.target.value)}
            placeholder="you@example.com"
            disabled={!!testSendReason}
            {...NO_AUTOFILL_PROPS}
          />
          <Tooltip content={testSendReason}>
            {testSendReason && (
              <span id={reasonId} className="sr-only">
                {testSendReason}
              </span>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={testSending || !!testSendReason}
              aria-describedby={testSendReason ? reasonId : undefined}
              onClick={onTestSend}
            >
              {testSending ? "Sending…" : "Send test"}
            </Button>
          </Tooltip>
        </div>
        {testResult && <TestResultPreview testResult={testResult} />}
      </div>
    </Card>
  );
}

export function MailTransportCard({
  title = "Mail transport",
  description = "Instance-wide outbound transport for tickets and lifecycle mail.",
  provider,
  providerOptions,
  fieldLocked,
  onSelectProvider,
}: Readonly<{
  title?: string;
  description?: string;
  provider: MailProvider | "";
  providerOptions: ReturnType<typeof buildMailProviderOptions>;
  fieldLocked: FieldLocked;
  onSelectProvider: (value: MailProvider | "") => void;
}>) {
  return (
    <Card
      title={<HintLabel hint={description}>{title}</HintLabel>}
      actions={
        <Badge variant={provider ? "ok" : "neutral"}>{provider ? "Configured" : "Not configured"}</Badge>
      }
    >
      <div className="mail-transport-form">
        {fieldLocked("provider") && (
          <p className="mail-transport__env-note">
            Some transport settings are managed by your deployment configuration and cannot be changed
            here. Contact your instance administrator if you need to update them.
          </p>
        )}
        <TransportTileGrid
          provider={provider}
          providerOptions={providerOptions}
          locked={fieldLocked("provider")}
          onSelect={onSelectProvider}
        />
        {provider === "export_only" && (
          <output className="mail-dev-warning">
            Dev/test only. Cannot send real mail in production.
          </output>
        )}
      </div>
    </Card>
  );
}

/** Inline validation error list rendered inside SettingsFooter, shared by both the
 * instance-level Mail transport panel and EventMailSettingsCard. Renders nothing when
 * there's nothing to report. */
export function ValidationErrorList({
  errors,
  errorsRef,
}: Readonly<{
  errors: string[];
  errorsRef: RefObject<HTMLUListElement | null>;
}>) {
  if (errors.length === 0) return null;
  return (
    <ul ref={errorsRef} role="alert" className="text-error">
      {errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  );
}

export function SettingsFooter({
  validationErrors,
  validationErrorsRef,
  hasUnsavedChanges,
  saving,
  busyLabel = "Saving…",
  onReset,
  onSave,
}: Readonly<{
  validationErrors: string[];
  validationErrorsRef: RefObject<HTMLUListElement | null>;
  hasUnsavedChanges: boolean;
  saving: boolean;
  /** Label while `saving` is true (e.g. "Uploading…" for a logo transfer). */
  busyLabel?: string;
  onReset: () => void;
  onSave: () => void;
}>) {
  const saveLabel = saving ? busyLabel : "Save";

  return (
    <div className="settings-footer">
      <div className="settings-footer__status">
        <ValidationErrorList errors={validationErrors} errorsRef={validationErrorsRef} />
        {validationErrors.length === 0 && hasUnsavedChanges && (
          <span className="settings-footer__save-state">
            <i className="ti ti-alert-triangle" aria-hidden="true" /> Unsaved changes
          </span>
        )}
      </div>
      <div className="settings-footer__buttons">
        <Button type="button" variant="secondary" disabled={saving} onClick={onReset}>
          Reset
        </Button>
        <Button type="button" variant="primary" disabled={saving} onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

/** Snapshots which fields are relevant to the tested provider — undefined fields
 * are simply not rendered by TestResultPreview. */
function snapshotFieldsFor(
  provider: MailProvider | undefined,
  host: string,
  port: string,
  mailbox: string,
): Pick<TestResult, "host" | "port" | "mailbox"> {
  return {
    host: provider === "smtp" ? host : undefined,
    port: provider === "smtp" ? port : undefined,
    mailbox: provider === "graph" ? mailbox : undefined,
  };
}

export function buildTestResult(
  result: MailTransportTestSendResponse,
  recipient: string,
  snapshotInputs: { host: string; port: string; mailbox: string },
): TestResult {
  const snapshot = snapshotFieldsFor(
    result.provider,
    snapshotInputs.host,
    snapshotInputs.port,
    snapshotInputs.mailbox,
  );
  const timestamp = new Date().toISOString();
  if (result.status === "sent") {
    return {
      kind: "ok",
      message: "Test email sent.",
      recipient,
      provider: result.provider,
      providerMessageId: result.providerMessageId,
      timestamp,
      ...snapshot,
    };
  }
  return {
    kind: "error",
    message: result.error ?? "Send failed.",
    recipient,
    provider: result.provider,
    retryable: result.retryable,
    timestamp,
    ...snapshot,
  };
}

export function testSendErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 400 && hasApiErrorCode(err, "validation_failed")) {
    return "Enter a valid email address.";
  }
  return operatorApiErrorMessage(err, "Send failed.");
}

/** Draft/secret/save-state, shared verbatim between MailTransportPanel and
 * EventMailSettingsCard — only what fetches/saves/tests the data differs per caller. */
export function useMailSettingsFormState() {
  const [draft, setDraft] = useState<MailDraft>(emptyMailDraft());
  const [secrets, setSecrets] = useState<SecretEdits>(emptySecretEdits());
  const [savedDraft, setSavedDraft] = useState<MailDraft>(emptyMailDraft());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const validationErrorsRef = useRef<HTMLUListElement | null>(null);
  // Bumped by every draft/secret edit so an in-flight test-send response can detect
  // it's now stale (config changed while the request was in the air) and skip
  // resurrecting a result the operator already moved past.
  const testGenerationRef = useRef(0);

  // A test result describes a specific saved configuration — any further edit (to
  // the draft or to a secret) makes it stale, so both wrappers invalidate it.
  const updateDraft = (patch: Partial<MailDraft>) => {
    testGenerationRef.current += 1;
    setTestResult(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  };

  const updateSecrets = (updater: (prev: SecretEdits) => SecretEdits) => {
    testGenerationRef.current += 1;
    setTestResult(null);
    setSecrets(updater);
  };

  // A fetch that resolves near-instantly (localhost, a warm cache) would otherwise flash
  // the "Loading…" text on and off faster than it can register as loading — show it only
  // once the fetch has genuinely taken a moment.
  const showLoading = useDelayedLoading(loading);

  return {
    draft,
    setDraft,
    secrets,
    setSecrets,
    savedDraft,
    setSavedDraft,
    loading,
    setLoading,
    showLoading,
    loadError,
    setLoadError,
    validationErrors,
    setValidationErrors,
    saving,
    setSaving,
    testEmail,
    setTestEmail,
    testSending,
    setTestSending,
    testResult,
    setTestResult,
    loadAbortRef,
    validationErrorsRef,
    testGenerationRef,
    updateDraft,
    updateSecrets,
  };
}

/** Client-side plausibility check only — the server does the authoritative validation.
 * Plain indexOf/slice rather than a regex — SonarCloud flagged the equivalent
 * /^[^\s@]+@[^\s@]+\.[^\s@]+$/ pattern as super-linear on adversarial input. */
function isPlausibleEmail(value: string): boolean {
  if (/\s/.test(value)) return false;
  const parts = value.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  const dot = domain.indexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

/** Validates the recipient, sends via `send`, and resolves the result into `TestResult` -
 * shared tail of the "Send test" flow between the org and event panels. Only the actual
 * send call (org- vs event-scoped) differs per caller. */
export async function runTestSend(params: {
  testEmail: string;
  draft: Pick<MailDraft, "host" | "port" | "mailbox" | "fromAddress">;
  send: (to: string) => Promise<MailTransportTestSendResponse>;
  testGenerationRef: RefObject<number>;
  setTestSending: (value: boolean) => void;
  setTestResult: (value: TestResult | null) => void;
  addToast: (message: string, variant?: "success" | "error" | "info" | "warning") => void;
}): Promise<void> {
  const { testEmail, draft, send, testGenerationRef, setTestSending, setTestResult, addToast } = params;
  const to = testEmail.trim();
  if (!isPlausibleEmail(to)) {
    addToast("Enter a valid email address.", "error");
    return;
  }
  const requestGeneration = testGenerationRef.current;
  const snapshotInputs = {
    host: draft.host,
    port: draft.port,
    mailbox: draft.mailbox || draft.fromAddress,
  };
  setTestSending(true);
  setTestResult(null);
  try {
    const result = await send(to);
    if (testGenerationRef.current !== requestGeneration) return;
    const nextResult = buildTestResult(result, to, snapshotInputs);
    setTestResult(nextResult);
    addToast(nextResult.message, nextResult.kind === "ok" ? "success" : "error");
  } catch (err) {
    if (testGenerationRef.current !== requestGeneration) return;
    const message = testSendErrorMessage(err);
    addToast(message, "error");
    setTestResult({ kind: "error", message, recipient: to, timestamp: new Date().toISOString() });
  } finally {
    setTestSending(false);
  }
}
