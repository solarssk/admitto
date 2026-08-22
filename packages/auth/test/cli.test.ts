import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { describe, expect, it, vi } from "vitest";

// readPasswordFromStdin's no-`reader` path reads from cli-helpers.ts's own `node:process` import
// (process.stdin/stderr) rather than an injectable stream, so exercising that path (as
// verifyTargetUserPassword and every other single-prompt caller does) needs process.stdin
// itself replaced with a fake, non-TTY stream - a real PassThrough works exactly like a piped
// stdin would. This doesn't affect the other tests below, which build and pass in their own
// readline.Interface/reader explicitly.
const fakeStdin = Object.assign(new PassThrough(), { isTTY: undefined as boolean | undefined });
const fakeStderr = new PassThrough();

vi.mock("node:process", () => ({ stdin: fakeStdin, stderr: fakeStderr }));

const { assertNoPasswordArgv, CliError, createLineReader, readPasswordFromStdin } = await import(
  "../src/cli-helpers.js"
);

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

  it("resolves a line asked for before it arrives, not just one already queued", async () => {
    // Complements the test above: this exercises the other half of createLineReader's queue -
    // a prompt awaiting a line that hasn't been typed/piped yet must be resolved directly by the
    // 'line' listener (a real TTY, one line at a time) instead of dequeuing something already
    // buffered.
    const stdin = new PassThrough();
    const rl = createInterface({ input: stdin, output: new PassThrough() });
    const readLine = createLineReader(rl, new PassThrough());

    const pending = readLine("confirm: ");
    stdin.write("yes\n");

    expect(await pending).toBe("yes");
    rl.close();
    stdin.end();
  });

  it("readPasswordFromStdin creates and reads from its own interface when no shared reader is passed in", async () => {
    // Every existing single-prompt call site (verifyTargetUserPassword, and this function's own
    // prior behavior before the force-confirmation chaining fix) never passes a reader - this is
    // that unchanged path, now sourced from a faked process.stdin instead of the real one.
    fakeStdin.write("Admitto-Dev-3003!\n");

    const password = await readPasswordFromStdin();

    expect(password).toBe("Admitto-Dev-3003!");
  });

  it("rejects with CliError when the piped answer is an empty line", async () => {
    fakeStdin.write("\n");

    await expect(readPasswordFromStdin()).rejects.toThrow(CliError);
  });
});
