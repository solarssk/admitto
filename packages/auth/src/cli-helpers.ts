import { stdin as input, stderr } from "node:process";
import { createInterface } from "node:readline";

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

/** Break-glass commands must never accept passwords on argv. */
export function assertNoPasswordArgv(argv: string[]): void {
  if (argv.includes("--password")) {
    throw new CliError("Password cannot be passed via --password; use the stdin prompt.");
  }
}

/** Read a password from stdin without echo when attached to a TTY. */
export async function readPasswordFromStdin(prompt = "Password: "): Promise<string> {
  if (!input.isTTY) {
    const rl = createInterface({ input, output: stderr });
    return new Promise((resolve, reject) => {
      rl.question(prompt, (answer) => {
        rl.close();
        if (!answer) reject(new CliError("Password required"));
        else resolve(answer);
      });
    });
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
