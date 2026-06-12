import mjml2html from "mjml";
import type { TemplateFormat } from "./types.js";
import { MjmlCompileError } from "./errors.js";

export async function compileTemplate(
  body: string,
  format: TemplateFormat,
): Promise<string> {
  if (format === "html") {
    return body;
  }

  try {
    const result = await mjml2html(body, { validationLevel: "strict" });
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
      throw new MjmlCompileError(
        (err as { errors: Array<{ message: string; formattedMessage?: string }> }).errors,
      );
    }
    throw err;
  }
}
