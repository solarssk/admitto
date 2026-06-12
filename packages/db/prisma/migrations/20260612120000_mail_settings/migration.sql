-- Per-scope mailer configuration storage (ADR 0005, ADR 0006).
-- Secrets stored as AES-256-GCM encrypted strings via @admitto/crypto.
-- CHECK constraints mirror the pattern from 20260611145854_roleassignment_scope_constraint.

CREATE TABLE "MailSettings" (
  "id"         TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_id"   TEXT NOT NULL,

  -- Provider (plain)
  "provider" TEXT,

  -- SMTP non-secret fields
  "host"                    TEXT,
  "port"                    INTEGER,
  "secure"                  BOOLEAN,
  "user"                    TEXT,
  "require_tls"             BOOLEAN,
  "tls_reject_unauthorized" BOOLEAN,
  "helo_name"               TEXT,
  "pool"                    BOOLEAN,
  "max_connections"         INTEGER,
  "max_messages"            INTEGER,
  "rate_limit_per_minute"   INTEGER,
  "connection_timeout"      INTEGER,
  "greeting_timeout"        INTEGER,
  "socket_timeout"          INTEGER,

  -- Graph non-secret fields
  "mailbox"            TEXT,
  "tenant_id"          TEXT,
  "client_id"          TEXT,
  "save_to_sent_items" BOOLEAN,

  -- Shared sender model (non-secret)
  "from_address"        TEXT,
  "from_name"           TEXT,
  "reply_to"            TEXT,
  "envelope_from"       TEXT,
  "allowed_from_domain" TEXT,

  -- Encrypted secrets (AES-256-GCM — never store plaintext)
  "smtp_password_enc"       TEXT,
  "graph_client_secret_enc" TEXT,
  "power_automate_key_enc"  TEXT,
  "power_automate_url_enc"  TEXT,

  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MailSettings_pkey" PRIMARY KEY ("id")
);

-- Each scope may have at most one MailSettings row.
CREATE UNIQUE INDEX "MailSettings_scope_type_scope_id_key"
  ON "MailSettings" ("scope_type", "scope_id");

-- Defense in depth: reject any row with an unknown scope_type at the DB layer.
ALTER TABLE "MailSettings"
  ADD CONSTRAINT "MailSettings_scope_type_check"
    CHECK (scope_type IN ('organization', 'event'));

-- Reject unknown provider values while allowing NULL (= unset / inherited from env).
ALTER TABLE "MailSettings"
  ADD CONSTRAINT "MailSettings_provider_check"
    CHECK (
      provider IS NULL OR
      provider IN ('graph', 'smtp', 'powerautomate', 'export_only')
    );
