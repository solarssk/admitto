import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { prisma } from "@admitto/db";
import { createApp } from "./app.js";
import { validateCfAccessBootConfig } from "./config.js";
import { devConsoleExportSink, warnExportOnlyProductionEnv } from "./dev-export-sink.js";

/** Boot the Admitto web server; wires a dev-only export_only sink when NODE_ENV is development. */
async function main(): Promise<void> {
  await validateCfAccessBootConfig(prisma);
  warnExportOnlyProductionEnv();

  const isDevelopment = process.env.NODE_ENV === "development";
  const app = createApp(
    isDevelopment ? { mailDeliveryDeps: { exportSink: devConsoleExportSink } } : {},
  );
  const port = parseInt(process.env["PORT"] ?? "3000", 10);

  // Dev-only, opt-in: if a local mkcert cert exists at apps/web/.certs
  // (gitignored — generate with `mkcert -cert-file apps/web/.certs/cert.pem
  // -key-file apps/web/.certs/key.pem <lan-ip> localhost 127.0.0.1`), serve
  // HTTPS with it instead of plain HTTP. Needed to test camera-requiring
  // check-in features from a phone over the LAN, since getUserMedia()
  // requires a secure context. Absent in CI/production, where this is
  // always plain HTTP as before.
  //
  // This file's own directory differs between `tsx src/index.ts` (dev) and
  // the compiled `dist/src/index.js` (`npm start`) — one dir shallower under
  // dist/src than under src, since tsconfig's rootDir is "." — so both
  // candidate locations are checked rather than assuming one (code review).
  const certDirCandidates = [
    fileURLToPath(new URL("../.certs/", import.meta.url)),
    fileURLToPath(new URL("../../.certs/", import.meta.url)),
  ];
  const certDir = certDirCandidates.find(
    (dir) =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from a fixed relative location, not user input
      existsSync(`${dir}cert.pem`) && existsSync(`${dir}key.pem`),
  );
  const useHttps = isDevelopment && certDir !== undefined;

  const options =
    useHttps && certDir !== undefined
      ? {
          fetch: app.fetch,
          port,
          createServer: createHttpsServer,
          serverOptions: {
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from a fixed relative location, not user input
            cert: readFileSync(`${certDir}cert.pem`),
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from a fixed relative location, not user input
            key: readFileSync(`${certDir}key.pem`),
          },
        }
      : { fetch: app.fetch, port };
  serve(options, () => {
    console.log(`Admitto web running at ${useHttps ? "https" : "http"}://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
