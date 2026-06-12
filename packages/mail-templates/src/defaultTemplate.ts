import type { ResolvedTemplate } from "./types.js";
import { compileTemplate } from "./compile.js";

/** Built-in default ticket email — MJML source (text-only header, no logo section). */
export const DEFAULT_SUBJECT_TEMPLATE = "Your ticket for {{event_name}}";

export const DEFAULT_BODY_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, Helvetica, sans-serif" />
      <mj-text font-size="16px" line-height="24px" color="#333333" />
    </mj-attributes>
  </mj-head>
  <mj-body background-color="#f4f4f4" width="600px">
    <mj-section background-color="#ffffff" padding="24px">
      <mj-column>
        <mj-text align="center" font-size="22px" font-weight="bold" padding-bottom="8px">
          {{event_name}}
        </mj-text>
        <mj-text padding-bottom="16px">
          Hi {{first_name}},
        </mj-text>
        <mj-text padding-bottom="16px">
          Your event ticket is ready. Use the button below to view your ticket and QR code.
        </mj-text>
        <mj-button href="{{ticket_url}}" background-color="#206bc4" color="#ffffff" font-size="16px" inner-padding="12px 24px" border-radius="4px">
          View your ticket
        </mj-button>
        <mj-image src="{{qr_image_url}}" alt="Ticket QR code" width="200px" height="200px" padding-top="24px" padding-bottom="8px" />
        <mj-text align="center" font-size="14px" color="#666666" padding-top="16px">
          {{event_date}} · {{event_location}}
        </mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

let cachedBuiltin: ResolvedTemplate | undefined;
let compilePromise: Promise<ResolvedTemplate> | undefined;

/** Pre-compiled built-in default (compiled once, lazily). */
export async function getBuiltinTemplate(): Promise<ResolvedTemplate> {
  if (cachedBuiltin) return cachedBuiltin;
  if (!compilePromise) {
    compilePromise = (async () => {
      const compiledHtmlTemplate = await compileTemplate(DEFAULT_BODY_MJML, "mjml");
      cachedBuiltin = {
        subjectTemplate: DEFAULT_SUBJECT_TEMPLATE,
        compiledHtmlTemplate,
        templateFormat: "mjml",
        source: "builtin",
      };
      return cachedBuiltin;
    })();
  }
  return compilePromise;
}
