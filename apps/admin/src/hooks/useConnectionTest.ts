import { useCallback, useState } from "react";
import { operatorApiErrorMessage } from "../api/operator-api-error.js";

type ConnectionTestResponse = {
  ok: boolean;
  message?: string;
  error?: string;
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
};

/** Shared async state and response normalization for saved-connection tests. */
export function useConnectionTest(errorFallback: string) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const clearResult = useCallback(() => setResult(null), []);

  const run = useCallback(
    async (testConnection: () => Promise<ConnectionTestResponse>) => {
      setTesting(true);
      setResult(null);
      try {
        const response = await testConnection();
        setResult({
          ok: response.ok,
          message: response.ok
            ? (response.message ?? "Connected.")
            : (response.error ?? "Could not connect."),
        });
      } catch (err) {
        setResult({
          ok: false,
          message: operatorApiErrorMessage(err, errorFallback),
        });
      } finally {
        setTesting(false);
      }
    },
    [errorFallback],
  );

  return { testing, result, run, clearResult };
}
