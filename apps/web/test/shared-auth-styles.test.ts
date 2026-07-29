import { describe, expect, it } from "vitest";
import { renderAuthDocument } from "../src/shared-auth-styles.js";

describe("renderAuthDocument", () => {
  it("uses the product name alone when an auth screen has no step", () => {
    const html = renderAuthDocument({ body: "<main>Sign in</main>" });

    expect(html).toContain("<title>Admitto</title>");
    expect(html).toContain('name="description" content="Admitto staff portal"');
  });

  it("separates the optional auth step with the standard plain-hyphen title and description", () => {
    const html = renderAuthDocument({ body: "<main>Sign in</main>", step: "Sign in" });

    expect(html).toContain("<title>Admitto - Sign in</title>");
    expect(html).toContain('name="description" content="Admitto staff portal - Sign in"');
  });
});
