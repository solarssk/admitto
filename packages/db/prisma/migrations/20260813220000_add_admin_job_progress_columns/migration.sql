-- Generic live-progress counter for AdminJob, for job types that run long enough to want one
-- (starting with wallet_push). Nullable/additive - import and export leave these null and keep
-- writing their own counts once at completion, unchanged.
ALTER TABLE "AdminJob" ADD COLUMN "progress_total" INTEGER, ADD COLUMN "progress_done" INTEGER;
