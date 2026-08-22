import { stdin as input, stderr } from "node:process";
import { createInterface, type Interface } from "node:readline";

/** CLI failure with a stable exit code for `main()` after cleanup. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Break-glass commands must never accept passwords on argv. Catches both the
 * space-separated form (`--password x`) and the single-token `--password=x` form. */
export function assertNoPasswordArgv(argv: string[]): void {
  if (argv.some((a) => a === "--password" || a.startsWith("--password="))) {
    throw new CliError("Password cannot be passed via --password; use the stdin prompt.");
  }
}

/** A line-at-a-time reader over an already-open readline.Interface, safe to await more than
 * once in sequence on the same (non-TTY) stdin - unlike Interface#question(), which only
 * catches the next 'line' event with a one-shot listener. When a scripted/piped caller (not a
 * human typing at a real TTY) writes multiple answers to stdin ahead of time, readline can
 * flush all of them as 'line' events synchronously in one go while parsing a single buffered
 * chunk; every line past the first has no listener registered yet to catch it and is dropped,
 * so a second question() call afterward waits forever on data that was already read and lost.
 * This registers one persistent 'line' listener up front and queues anything it emits before
 * the next prompt asks for it, so nothing gets lost regardless of how the answers arrive. */
export function createLineReader(rl: Interface, output: NodeJS.WritableStream): (prompt: string) => Promise<string> {
  const queued: string[] = [];
  const waiting: Array<(line: string) => void> = [];
  rl.on("line", (line) => {
    const waiter = waiting.shift();
    if (waiter) waiter(line);
    else queued.push(line);
  });
  return (prompt: string) => {
    output.write(prompt);
    const line = queued.shift();
    if (line !== undefined) return Promise.resolve(line);
    return new Promise((resolve) => waiting.push(resolve));
  };
}

/** Read a password from stdin without echo when attached to a TTY.
 *
 * `reader` lets a caller that already prompted once on the same non-TTY stdin (e.g. a
 * force-confirmation before this) pass in its own createLineReader() instead of this function
 * creating and reading from a fresh readline.Interface - see createLineReader's own comment for
 * why chaining two separate Interface#question() calls on piped stdin can otherwise hang. */
export async function readPasswordFromStdin(
  prompt = "Password: ",
  reader?: (prompt: string) => Promise<string>,
): Promise<string> {
  if (!input.isTTY) {
    const ownRl = reader ? undefined : createInterface({ input, output: stderr });
    const readLine = reader ?? createLineReader(ownRl!, stderr);
    const answer = await readLine(prompt);
    ownRl?.close();
    if (!answer) throw new CliError("Password required");
    return answer;
  }

  stderr.write(prompt);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  let password = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: string) => {
      const ch = chunk;
      if (ch === "\n" || ch === "\r" || ch === "\u0004") {
        input.setRawMode(false);
        input.pause();
        input.removeListener("data", onData);
        stderr.write("\n");
        if (!password) reject(new CliError("Password required"));
        else resolve(password);
        return;
      }
      if (ch === "\u0003") {
        input.setRawMode(false);
        input.pause();
        input.removeListener("data", onData);
        stderr.write("\n");
        reject(new CliError("Aborted", 130));
        return;
      }
      if (ch === "\u007f" || ch === "\b") {
        password = password.slice(0, -1);
        return;
      }
      password += ch;
    };
    input.on("data", onData);
  });
}
