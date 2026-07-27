-- CreateTable
CREATE TABLE "SecurityAuditLog" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "user_id" TEXT,
    "ip" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityAuditLog_event_type_created_at_idx" ON "SecurityAuditLog"("event_type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "SecurityAuditLog_user_id_idx" ON "SecurityAuditLog"("user_id");
