import { describe, expect, it } from "vitest";
import { renderNoticeHtml } from "../../src/auth-notice.js";

describe("renderNoticeHtml", () => {
  it("emits Notice-equivalent markup with escaped message and default error icon", () => {
    const html = renderNoticeHtml({
      variant: "error",
      role: "alert",
      message: `Bad <script> & "quotes"`,
    });
    expect(html).toContain('class="at-notice at-notice--error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("ti ti-circle-x at-notice__icon");
    expect(html).toContain("at-notice__body");
    expect(html).toContain("Bad &lt;script&gt; &amp; &quot;quotes&quot;");
    expect(html).not.toContain("<script>");
  });

  it("uses warning icon for SSO-style notices", () => {
    const html = renderNoticeHtml({
      variant: "warning",
      role: "alert",
      message: "SSO unavailable. Use your local password below.",
    });
    expect(html).toContain("at-notice--warning");
    expect(html).toContain("ti ti-alert-triangle");
  });
});
