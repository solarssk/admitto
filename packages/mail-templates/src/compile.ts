import { tmpdir } from "node:os";
import mjml2html from "mjml";
import type { TemplateFormat } from "./types.js";
import { MjmlCompileError, type MjmlRawError } from "./errors.js";

export async function compileTemplate(
  body: string,
  format: TemplateFormat,
): Promise<string> {
  if (format === "html") {
    return body;
  }

  try {
    // Without an explicit filePath, mjml resolves against process.cwd(), leaking the server's
    // real application directory into any validation error's formattedMessage (e.g. "Line 5 of
    // /Users/.../apps/web ..."). mjml-parser-xml requires this path to actually exist on disk
    // (it lstat()s it before anything else, throwing "Specified filePath does not exist"
    // otherwise - confirmed the hard way, an arbitrary synthetic path is not accepted) - the OS
    // temp directory is the one path guaranteed to exist in every environment this runs in
    // (dev, CI, container) without revealing this app's own directory layout.
    const result = await mjml2html(body, { validationLevel: "strict", filePath: tmpdir() });
    if (result.errors.length > 0) {
      throw new MjmlCompileError(result.errors);
    }
    return result.html;
  } catch (err) {
    if (err instanceof MjmlCompileError) throw err;
    if (
      err !== null &&
      typeof err === "object" &&
      "errors" in err &&
      Array.isArray((err as { errors: unknown }).errors)
    ) {
      throw new MjmlCompileError((err as { errors: MjmlRawError[] }).errors);
    }
    throw err;
  }
}
