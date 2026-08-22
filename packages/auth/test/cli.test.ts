import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { assertNoPasswordArgv, CliError, createLineReader, readPasswordFromStdin } from "../src/cli-helpers.js";

describe("CLI break-glass", () => {
  it("rejects --password on argv for break-glass commands", () => {
    expect(() =>
      assertNoPasswordArgv(["node", "cli.js", "reset-mfa", "--email", "a@example.com", "--password", "x"]),
    ).toThrow(CliError);
    expect(() =>
      assertNoPasswordArgv([
        "node",
        "cli.js",
        "generate-emergency-recovery",
        "--email",
        "a@example.com",
        "--password",
        "x",
      ]),
    ).toThrow(CliError);
  });

  it("allows break-glass argv without --password", () => {
    expect(() =>
      assertNoPasswordArgv(["node", "cli.js", "reset-mfa", "--email", "admin@example.com"]),
    ).not.toThrow();
  });

  it("rejects the single-token --password=<value> form, not just the space-separated form", () => {
    expect(() =>
      assertNoPasswordArgv(["node", "cli.js", "reset-mfa", "--email", "a@example.com", "--password=x"]),
    ).toThrow(CliError);
    expect(() =>
      assertNoPasswordArgv([
        "node",
        "cli.js",
        "generate-emergency-recovery",
        "--email",
        "a@example.com",
        "--password=x",
      ]),
    ).toThrow(CliError);
  });

  it("rejects --password on argv for bootstrap-superadmin, both forms", () => {
    expect(() =>
      assertNoPasswordArgv(["node", "cli.js", "bootstrap-superadmin", "--email", "a@example.com", "--password", "x"]),
    ).toThrow(CliError);
    expect(() =>
      assertNoPasswordArgv([
        "node",
        "cli.js",
        "bootstrap-superadmin",
        "--email",
        "a@example.com",
        "--password=x",
      ]),
    ).toThrow(CliError);
  });

  it("allows bootstrap-superadmin argv without --password", () => {
    expect(() =>
      assertNoPasswordArgv(["node", "cli.js", "bootstrap-superadmin", "--email", "admin@example.com", "--force"]),
    ).not.toThrow();
  });
});

describe("createLineReader + readPasswordFromStdin", () => {
  it("reads a second answer after an earlier prompt already resolved, even when both were piped in one write", async () => {
    // Regression for a real hang: bootstrap-superadmin --force chains a confirmation prompt and
    // this password prompt on the same piped stdin. A scripted/non-interactive caller (a deploy
    // script, `printf 'yes\npassword\n' | ...`) writes both answers to stdin before either
    // prompt ever asks - readline can flush all of the buffered chunk's lines as 'line' events
    // synchronously in one go, and a plain Interface#question() only registers a one-shot
    // listener for the *next* one, so the second line has nothing to catch it and is dropped;
    // a later question() call then waits forever on data that was already read and lost. Even
    // reusing one interface for both question() calls doesn't fix this - only createLineReader's
    // persistent listener (which queues anything emitted before it's asked for) does.
    const stdin = new PassThrough();
    const rl = createInterface({ input: stdin, output: new PassThrough() });
    const readLine = createLineReader(rl, new PassThrough());
    // Both lines arrive in one write, before either prompt has asked its question.
    stdin.write("yes\nAdmitto-Dev-3003!\n");
    stdin.end();

    const confirmation = await readLine("confirm: ");
    expect(confirmation).toBe("yes");

    const password = await readPasswordFromStdin("Password: ", readLine);
    expect(password).toBe("Admitto-Dev-3003!");

    rl.close();
  });
});
