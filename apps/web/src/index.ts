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
      `Ignoring local dev cert at ${certDir} (unreadable), falling back to HTTP:`,
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

/**
 * `@hono/node-server` binds to every interface (LAN-reachable) unless a hostname is
 * given. In HTTP-only development we stay on loopback only (PO review: safety). HTTPS
 * with a local mkcert may omit the override so phone-over-LAN camera testing works.
 * Production keeps the default (`undefined`) for the container / reverse-proxy network.
 *
 * Return both IPv4 and IPv6 loopback: on dual-stack macOS, `localhost` often resolves to
 * `::1` while some tools use `127.0.0.1` — binding only one family breaks the other.
 */
export function resolveDevServeHostnames(
  isDevelopment: boolean,
  useHttps: boolean,
): readonly string[] | undefined {
  if (isDevelopment && !useHttps) return ["127.0.0.1", "::1"];
  return undefined;
}

/** @deprecated Prefer `resolveDevServeHostnames` — kept for older call sites/tests. */
export function resolveDevServeHostname(isDevelopment: boolean, useHttps: boolean): string | undefined {
  return resolveDevServeHostnames(isDevelopment, useHttps)?.[0];
}

/** Boot the Admitto web server; wires a dev-only export_only sink when NODE_ENV is development. */
async function main(): Promise<void> {
  await validateCfAccessBootConfig(prisma);
  warnExportOnlyProductionEnv();

  const isDevelopment = process.env.NODE_ENV === "development";
  const app = createApp(
    isDevelopment ? { mailDeliveryDeps: { exportSink: devConsoleExportSink } } : {},
  );
  const port = Number.parseInt(process.env["PORT"] ?? "3000", 10);

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

  const loopbackHosts = resolveDevServeHostnames(isDevelopment, useHttps);

  if (httpsCerts) {
    serve(
      {
        fetch: app.fetch,
        port,
        hostname: loopbackHosts?.[0],
        createServer: createHttpsServer,
        serverOptions: httpsCerts,
      },
      () => {
        console.log(`Admitto web running at https://localhost:${port}`);
      },
    );
    return;
  }

  if (loopbackHosts) {
    for (const hostname of loopbackHosts) {
      const optional = hostname === "::1";
      const server = serve({ fetch: app.fetch, port, hostname }, () => {
        const label = hostname === "::1" ? "localhost" : hostname;
        console.log(`Admitto web running at http://${label}:${port}`);
      });
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (
          optional &&
          (err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL")
        ) {
          console.warn(
            `IPv6 loopback (::1) unavailable (${err.code}); continuing with 127.0.0.1 only`,
          );
          return;
        }
        console.error(err);
        process.exit(1);
      });
    }
    return;
  }

  serve({ fetch: app.fetch, port }, () => {
    console.log(`Admitto web running at http://0.0.0.0:${port}`);
  });
}

// Don't boot a real server (or connect to Prisma) when this file is imported by a
// unit test pulling in resolveDevServeHostname — same NODE_ENV=test guard already
// used for this exact reason in ops/migrations-check.ts, rather than an
// import.meta.url/argv[1] comparison, which breaks if the invocation path ever
// crosses a symlink (e.g. a symlinked release directory).
if (process.env.NODE_ENV !== "test") {
  try {
    await main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
