/**
 * CLI for manual test sends via a selected transport.
 * Configuration from .env (MAILER_*). Provider selection: MAILER_PROVIDER.
 *
 *   npm run send -- --to someone@example.com
 *   npm run send -- --csv recipients.csv          (columns: email,first_name)
 *
 * Useful for testing an SMTP server locally (MAILER_PROVIDER=smtp).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configFromEnv } from "./configFromEnv.js";
import { createMailer, sendBatch } from "./index.js";
import type { MailMessage } from "./types.js";
import { splitCsvLine } from "./csvUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function renderHtml(firstName?: string): string {
  const hi = firstName ? `Hello ${firstName},` : "Hello,";
  return `<p>${hi}</p><p>Test email from Admitto (@admitto/mailer).</p><p>[production: ticket link + QR + Wallet]</p>`;
}

function readCsv(file: string): { email: string; firstName?: string }[] {
  const p = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const lines = fs.readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const header = splitCsvLine(lines.shift()!).map((h) => h.trim().toLowerCase());
  const ei = header.indexOf("email");
  const ni = header.indexOf("first_name");
  if (ei === -1) throw new Error("CSV must have an 'email' column");
  return lines
    .map((l) => {
      const c = splitCsvLine(l);
      return { email: (c[ei] ?? "").trim(), firstName: ni !== -1 ? (c[ni] ?? "").trim() : undefined };
    })
    .filter((r) => r.email);
}

async function main() {
  loadDotEnv();
  const config = configFromEnv();
  const mailer = createMailer(config);
  console.log(`provider = ${config.provider}`);

  const subject = arg("subject", "Admitto — test (@admitto/mailer)")!;
  const csv = arg("csv");

  if (csv) {
    const rows = readCsv(csv);
    const messages: MailMessage[] = rows.map((r) => ({
      to: r.email,
      subject,
      html: renderHtml(r.firstName),
    }));
    console.log(`Batch: ${messages.length} recipients...`);
    const summary = await sendBatch(mailer, messages, {
      concurrency: 3,
      onResult: (res, msg, i) =>
        console.log(`  [${i + 1}/${messages.length}] ${res.status === "sent" ? "✅" : "❌"} ${msg.to}${res.error ? " — " + res.error : ""}`),
    });
    console.log(`\nSummary: sent=${summary.sent} failed=${summary.failed} total=${summary.total}`);
    process.exit(summary.failed ? 1 : 0);
  }

  const to = arg("to");
  if (!to) {
    console.error("Provide --to <address> or --csv <file>");
    process.exit(1);
  }
  const result = await mailer.send({ to, subject, html: renderHtml(arg("name")) });
  if (result.status === "sent") {
    console.log(`✅ sent (id: ${result.providerMessageId ?? "—"})`);
  } else {
    console.error(`❌ error: ${result.error}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
