/** Row-level status for Settings Health (ADR 0037). */
export type HealthRowStatus = "ok" | "degraded" | "down" | "not_configured" | "planned";

/** Group / overall status: ignores planned and not_configured rows. */
export type HealthOverallStatus = "ok" | "degraded" | "down";
