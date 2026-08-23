import { startAuthentication } from "@simplewebauthn/browser";
import { Button } from "@admitto/ui";
import { ApiError, beginWebauthnAssertion } from "../api/client.js";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";
import type { StepUpProofBody } from "../api/types.js";

/** Run a WebAuthn step-up ceremony (fetch a challenge, prompt the browser, sign it) and return
 * the proof to submit alongside whichever step-up-gated action is in flight. Rethrows on any
 * failure (cancelled, wrong/no credential, network) - callers show their own inline error, the
 * same way a wrong TOTP code is already handled per dialog. */
export async function runWebauthnStepUp(): Promise<StepUpProofBody> {
  const { options } = await beginWebauthnAssertion();
  const response = await startAuthentication({ optionsJSON: options });
  return { webauthn: { response } };
}

interface WebauthnStepUpButtonProps {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onSubmit: (proof: StepUpProofBody) => Promise<void>;
}

/** "Use a passkey or security key" button for a step-up dialog that already collects a TOTP/
 * recovery code, reused across My Account's step-up-gated actions (password change, MFA reset,
 * removing a credential, regenerating backup codes, unlinking SSO) instead of each duplicating
 * the same begin/prompt/submit/error-handling ceremony. Caller owns its own busy/error state
 * (already exists per dialog for the code field) and its own submit function; this component only
 * runs the ceremony and hands the resulting proof to `onSubmit`. */
export function WebauthnStepUpButton({ busy, onBusyChange, onError, onSubmit }: Readonly<WebauthnStepUpButtonProps>) {
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        onBusyChange(true);
        onError(null);
        let proof: StepUpProofBody;
        try {
          proof = await runWebauthnStepUp();
        } catch (err) {
          onError(
            err instanceof Error && err.name === "NotAllowedError"
              ? "Passkey or security key step-up was cancelled."
              : "Could not verify with your passkey or security key. Try again, or enter a code instead.",
          );
          onBusyChange(false);
          return;
        }
        try {
          await onSubmit(proof);
        } catch (err) {
          // The ceremony itself already succeeded here - a thrown ApiError is the protected
          // action rejecting the proof (session expired, rate-limited, target already gone),
          // not a failed passkey/security key verification, so it gets its own message instead
          // of the ceremony-cancelled copy above.
          onError(
            err instanceof ApiError
              ? operatorApiErrorMessage(err, "Failed to complete the action.")
              : "Could not verify with your passkey or security key. Try again, or enter a code instead.",
          );
        } finally {
          onBusyChange(false);
        }
      }}
    >
      Use a passkey or security key
    </Button>
  );
}
