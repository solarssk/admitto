import { afterEach, describe, expect, it, vi } from "vitest";

describe("getBuiltinTemplate", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("retries compilation after the first attempt fails", async () => {
    const compileTemplate = vi
      .fn()
      .mockRejectedValueOnce(new Error("mjml down"))
      .mockResolvedValueOnce("<table>ok</table>");

    vi.doMock("../src/compile.js", () => ({ compileTemplate }));

    const { getBuiltinTemplate, resetBuiltinTemplateCacheForTests } = await import(
      "../src/defaultTemplate.js"
    );

    await expect(getBuiltinTemplate()).rejects.toThrow("mjml down");
    resetBuiltinTemplateCacheForTests();
    const resolved = await getBuiltinTemplate();

    expect(compileTemplate).toHaveBeenCalledTimes(2);
    expect(resolved.compiledHtmlTemplate).toBe("<table>ok</table>");
    expect(resolved.source).toBe("builtin");
  });
});
