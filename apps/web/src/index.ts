import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { prisma } from "@admitto/db";
import { createApp } from "./app.js";
import { validateCfAccessBootConfig } from "./config.js";
import { devConsoleExportSink, warnExportOnlyProductionEnv } from "./dev-export-sink.js";

type HttpsServerOptions = { cert: Buffer; key: Buffer };

/** Reads the mkcert cert/key pair for dev HTTPS. Corrupted/unreadable files
 * (a truncated or hand-edited cert, say) fall back to plain HTTP with a
 * warning instead of crashing server startup entirely (code review). */
function readHttpsCerts(certDir: string): HttpsServerOptions | undefined {
  try {
    return {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from a fixed relative location, not user input
      cert: readFileSync(`${certDir}cert.pem`),
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path joined from a fixed relative location, not user input
      key: readFileSync(`${certDir}key.pem`),
    };
  } catch (err) {
    console.warn(
      `Ignoring local dev cert at ${certDir} (unreadable) — falling back to HTTP:`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

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
  const httpsCerts = isDevelopment && certDir !== undefined ? readHttpsCerts(certDir) : undefined;
  const useHttps = httpsCerts !== undefined;

  // `@hono/node-server` binds to every interface (LAN-reachable) unless a
  // hostname is given. In dev, that's only actually wanted while a local
  // cert is present for phone-over-LAN camera testing — otherwise the dev
  // server has no business being reachable from other devices on the
  // network (PO review: safety). Production keeps the default (no
  // hostname override) since it needs to accept traffic from the container
  // network / reverse proxy, not just loopback.
  const hostname = isDevelopment && !useHttps ? "localhost" : undefined;

  const options = httpsCerts
    ? {
        fetch: app.fetch,
        port,
        hostname,
        createServer: createHttpsServer,
        serverOptions: httpsCerts,
      }
    : { fetch: app.fetch, port, hostname };
  serve(options, () => {
    console.log(`Admitto web running at ${useHttps ? "https" : "http"}://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
