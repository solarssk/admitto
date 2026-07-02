import { createInterface } from "node:readline";

export async function confirmYes(prompt: string): Promise<boolean> {
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
