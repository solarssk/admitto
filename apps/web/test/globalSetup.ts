import { ensureTestSchema } from "./ensureTestSchema.js";

export default async function globalSetup(): Promise<void> {
  await ensureTestSchema();
}
