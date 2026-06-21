-- Instance/org-scoped admin audit log (ADR 0031).

CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "actor_user_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "metadata" JSONB,
    "ip" TEXT,
    "session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_organization_id_created_at_idx" ON "AdminAuditLog"("organization_id", "created_at" DESC);
