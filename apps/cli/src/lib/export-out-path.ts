import path from "node:path";
import { CliError } from "./args.js";

function isPathInside(child: string, parent: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  return (
    resolvedChild === resolvedParent ||
    resolvedChild.startsWith(`${resolvedParent}${path.sep}`)
  );
}

/**
 * Restrict emergency CSV exports to EMERGENCY_EXPORT_DIR and block UPLOAD_DIR
 * (served publicly at /uploads/*). Skips prefix checks when env vars are unset
 * (local dev without Docker env).
 */
export function assertSafeEmergencyExportOut(
  out: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const resolvedOut = path.resolve(out);

  const uploadDir = env.UPLOAD_DIR?.trim();
  if (uploadDir && isPathInside(resolvedOut, uploadDir)) {
    throw new CliError(
      `--out must not be under UPLOAD_DIR (${path.resolve(uploadDir)}): /uploads is served without auth.`,
    );
  }

  const emergencyDir = env.EMERGENCY_EXPORT_DIR?.trim();
  if (emergencyDir && !isPathInside(resolvedOut, emergencyDir)) {
    throw new CliError(
      `--out must be under EMERGENCY_EXPORT_DIR (${path.resolve(emergencyDir)}).`,
    );
  }
}
