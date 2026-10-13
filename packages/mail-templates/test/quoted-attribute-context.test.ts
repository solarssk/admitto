/// <reference lib="dom" />
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { compileTemplate } from "../src/compile.js";
import { getHtmlAttributeContext } from "../src/htmlContext.js";
import {
  materializeStoredDeliveryMessage,
  renderTemplate,
  renderTemplateTrusted,
  renderTemplateTrustedForStorage,
  type RenderTemplateInput,
} from "../src/render.js";
import type { RenderedTemplate, TemplateVars } from "../src/types.js";
import {
  assertRenderableCompiledHtml,
  assertValidTemplate,
  findMissingRequiredPlaceholders,
} from "../src/validate.js";


interface QuoteCase {
  readonly label: string;
  readonly delimiter: '"' | "'";
  readonly rawName: string;
  readonly encodedName: string;
}

const QUOTES = [
  {
    label: "double-quoted",
    delimiter: '"',
    rawName: 'Ada" data-audit-marker="synthetic',
    encodedName: "Ada&quot; data-audit-marker=&quot;synthetic",
  },
  {
    label: "single-quoted",
    delimiter: "'",
    rawName: "Ada' data-audit-marker='synthetic",
    encodedName: "Ada&#39; data-audit-marker=&#39;synthetic",
  },
] as const satisfies readonly QuoteCase[];

interface AttributeCase {
  readonly label: string;
  readonly sourcePrefix: string;
  readonly decodedPrefix: string;
  readonly attributeName?: string;
  readonly leadingAttributes?: string;
}

const ATTRIBUTES = [
  {
    label: "ordinary title",
    sourcePrefix: "Guest: ",
    decodedPrefix: "Guest: ",
  },
  {
    label: "entity-escaped-angle title",
    sourcePrefix: "Guest &lt;b&gt;: ",
    decodedPrefix: "Guest <b>: ",
  },
  {
    label: "literal-angle title",
    sourcePrefix: "Guest <b>: ",
    decodedPrefix: "Guest <b>: ",
  },
  {
    label: "numeric quoted attribute",
    sourcePrefix: "Guest <b>: ",
    decodedPrefix: "Guest <b>: ",
    attributeName: "0",
  },
  {
    label: "numeric quoted attribute before title",
    sourcePrefix: "Guest: ",
    decodedPrefix: "Guest: ",
    leadingAttributes: '0="Earlier <b>" ',
  },
] as const satisfies readonly AttributeCase[];

interface RenderingPath {
  readonly label: string;
  readonly render: (input: RenderTemplateInput, vars: TemplateVars) => RenderedTemplate;
}

const RENDERING_PATHS = [
  { label: "ordinary", render: renderTemplate },
  { label: "trusted", render: renderTemplateTrusted },
  { label: "trusted-storage", render: renderTemplateTrustedForStorage },
] as const satisfies readonly RenderingPath[];

function customTemplate(quote: QuoteCase, attribute: AttributeCase): RenderTemplateInput {
  return {
    subject: "Synthetic attribute test",
    compiledHtml:
      `<span id="audit-guest" ${attribute.leadingAttributes ?? ""}${attribute.attributeName ?? "title"}=${quote.delimiter}${attribute.sourcePrefix}{{first_name}}${quote.delimiter}>Guest</span>` +
      // Required URL placeholders are text only: no resource loads or navigation.
      "<p>{{ticket_url}} {{qr_image_url}}</p>",
  };
}

describe("quoted attribute context and rendering", () => {
  describe.each(QUOTES)("$label", (quote) => {
    describe.each(RENDERING_PATHS)("$label rendering", (path) => {
      it.each(ATTRIBUTES)("$label preserves quoted context and inert marker data", (attribute: AttributeCase) => {
        const input = customTemplate(quote, attribute);
        const vars: TemplateVars = {
          first_name: quote.rawName,
          ticket_url: "https://tickets.example.com/t/synthetic",
          qr_image_url: "https://tickets.example.com/q/synthetic.png",
        };

        expect(input.compiledHtml.length).toBeLessThan(512);
        expect(quote.rawName.length).toBeLessThan(64);
        expect(() =>
          assertValidTemplate({ subject: input.subject, body: input.compiledHtml }),
        ).not.toThrow();
        expect(() => assertRenderableCompiledHtml(input.compiledHtml)).not.toThrow();
        expect(findMissingRequiredPlaceholders(input.subject, input.compiledHtml)).toEqual([]);

        const placeholderIndex = input.compiledHtml.indexOf("{{first_name}}");
        expect(placeholderIndex).toBeGreaterThan(0);
        expect.soft(getHtmlAttributeContext(input.compiledHtml, placeholderIndex)).toEqual({
          inTag: true,
          inQuotedAttribute: true,
          unquotedAttributeName: null,
          inBareTagMarkup: false,
        });

        const rendered = path.render(input, vars);
        expect.soft(rendered.html).toContain(attribute.sourcePrefix + quote.encodedName);

        const parsed = new DOMParser().parseFromString(rendered.html, "text/html");
        const guest = parsed.getElementById("audit-guest");
        expect(guest).not.toBeNull();
        if (!guest) throw new Error("Synthetic guest fixture is missing");

        expect.soft(guest.getAttribute(attribute.attributeName ?? "title")).toBe(attribute.decodedPrefix + quote.rawName);
        expect.soft(guest.getAttributeNames().sort()).toEqual(["id", attribute.attributeName ?? "title", ...(attribute.leadingAttributes ? ["0"] : [])].sort());
        expect.soft(parsed.querySelector("[data-audit-marker]")).toBeNull();
      });
    });
  });
});


describe("compiled and deferred attribute boundaries", () => {
  it.each(["html", "mjml"] as const)("preserves attribute context after %s compilation", async (format) => {
    const input = customTemplate(QUOTES[0], ATTRIBUTES[2]);
    const source = format === "html" ? input.compiledHtml :
      `<mjml><mj-body><mj-section><mj-column><mj-text>${input.compiledHtml}</mj-text></mj-column></mj-section></mj-body></mjml>`;
    expect(() => assertValidTemplate({ subject: input.subject, body: source })).not.toThrow();
    const compiledHtml = await compileTemplate(source, format);
    expect(() => assertRenderableCompiledHtml(compiledHtml)).not.toThrow();
    const rendered = renderTemplate({ subject: input.subject, compiledHtml }, {
      first_name: QUOTES[0].rawName, ticket_url: "https://tickets.example.com/t/synthetic", qr_image_url: "https://tickets.example.com/q/synthetic.png",
    });
    const parsed = new DOMParser().parseFromString(rendered.html, "text/html");
    expect(parsed.getElementById("audit-guest")?.getAttribute("title")).toBe(ATTRIBUTES[2].decodedPrefix + QUOTES[0].rawName);
    expect(parsed.querySelector("[data-audit-marker]")).toBeNull();
  });

  it.each(QUOTES)("keeps multiple placeholders and body text independent ($label)", (quote) => {
    const html = `<div><span id="audit-guest" data-count=100" title=${quote.delimiter}Line\n<b> {{first_name}} / {{last_name}}${quote.delimiter}>Guest</span></div>` +
      '<p id="text">{{first_name}}</p><p>{{ticket_url}} {{qr_image_url}}</p>';
    const rendered = renderTemplate({ subject: "{{first_name}}", compiledHtml: html }, {
      first_name: quote.rawName, last_name: "Synthetic Person", ticket_url: "https://tickets.example.com/t/synthetic", qr_image_url: "https://tickets.example.com/q/synthetic.png",
    });
    const parsed = new DOMParser().parseFromString(rendered.html, "text/html");
    expect(parsed.getElementById("audit-guest")?.getAttribute("title")).toBe(`Line\n<b> ${quote.rawName} / Synthetic Person`);
    expect(parsed.getElementById("text")?.textContent).toBe(quote.rawName);
    expect(rendered.subject).toBe(quote.rawName);
    expect(parsed.querySelector("[data-audit-marker]")).toBeNull();
  });

  it("preserves deferred URL placeholders and materializes them after attendee escaping", () => {
    const frozen = renderTemplateTrustedForStorage({
      subject: "Ticket {{ticket_url}}",
      compiledHtml: '<a id="audit-guest" title="Guest <b>: {{first_name}}" href="{{ticket_url}}">Ticket</a><p>{{qr_image_url}}</p>',
    }, { first_name: QUOTES[0].rawName });
    expect(frozen.html).toContain('href="{{ticket_url}}"');
    expect(frozen.subject).toBe("Ticket {{ticket_url}}");
    const ticket = "https://tickets.example.com/t/synthetic?one=1&two=2";
    const rendered = materializeStoredDeliveryMessage(frozen, { ticket_url: ticket, qr_image_url: "https://tickets.example.com/q/synthetic.png", apple_wallet_url: "", google_wallet_url: "" });
    const parsed = new DOMParser().parseFromString(rendered.html, "text/html");
    expect(parsed.getElementById("audit-guest")?.getAttribute("title")).toBe(ATTRIBUTES[2].decodedPrefix + QUOTES[0].rawName);
    expect(parsed.getElementById("audit-guest")?.getAttribute("href")).toBe(ticket);
    expect(rendered.subject).toBe(`Ticket ${ticket}`);
    expect(parsed.querySelector("[data-audit-marker]")).toBeNull();
  });
});
