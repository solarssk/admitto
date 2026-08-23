import { createInterface } from "node:readline";

/** `readLine` lets a caller that will prompt again right after this on the same non-TTY stdin
 * (e.g. a password prompt following this confirmation) pass in its own createLineReader()
 * (@admitto/auth/cli-helpers) instead of this function creating and reading from a fresh
 * readline.Interface - see createLineReader's own comment for why chaining two separate
 * Interface#question() calls on piped stdin can otherwise hang. */
export async function confirmYes(prompt: string, readLine?: (prompt: string) => Promise<string>): Promise<boolean> {
  if (readLine) {
    const answer = await readLine(prompt);
    return answer.trim().toLowerCase() === "yes";
  }

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      rl.close();
      resolve(value);
    };
    rl.on("close", () => finish(false));
    rl.question(prompt, (answer) => {
      finish(answer.trim().toLowerCase() === "yes");
    });
  });
}
