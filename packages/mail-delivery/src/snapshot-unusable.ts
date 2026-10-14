import { materializeStoredDeliveryMessage } from "@admitto/mail-templates";

/** Stored on a delivery whose frozen message the renderer now refuses. Fixed text: never the exception's. */
export const SNAPSHOT_UNUSABLE_ERROR = "The stored message can no longer be rendered.";

/**
 * Fill the ticket and wallet links into a frozen delivery snapshot, or `null` when the renderer
 * rejects the stored text (for example a snapshot saved before a stricter template check). One
 * such row must fail on its own: letting the exception out would stop the whole send, drain or
 * retry run, and the same row would stop the next one too.
 */
export function tryMaterializeStoredMessage(
  frozen: Parameters<typeof materializeStoredDeliveryMessage>[0],
  links: Parameters<typeof materializeStoredDeliveryMessage>[1],
): ReturnType<typeof materializeStoredDeliveryMessage> | null {
  try {
    return materializeStoredDeliveryMessage(frozen, links);
  } catch {
    return null;
  }
}

/**
 * Row update for a snapshot that cannot be rendered: failed, not retryable (a retry cannot change
 * the text), fixed error. `error_code` is cleared so a code left by an earlier provider attempt
 * is not shown next to this failure.
 */
export function snapshotUnusableUpdate() {
  const now = new Date();
  return {
    status: "failed" as const,
    retryable: false,
    error: SNAPSHOT_UNUSABLE_ERROR,
    error_code: null,
    attempted_at: now,
    failed_at: now,
  };
}
