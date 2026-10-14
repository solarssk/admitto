import { describe, expect, it, vi } from "vitest";
import {
  materializeStoredDeliveryMessage,
  renderTemplate,
  renderTemplateTrusted,
  renderTemplateTrustedForStorage,
} from "../src/render.js";
import { assertValidTemplate } from "../src/validate.js";

const count = 5_000;
const html = '<span title="<b>{{first_name}}"></span>'.repeat(count) +
  '<p>{{ticket_url}} {{qr_image_url}}</p>';
const input = { subject: "Synthetic scan cost", compiledHtml: html };
const vars = {
  first_name: 'Synthetic" guest',
  ticket_url: "https://tickets.example.com/t/synthetic",
  qr_image_url: "https://tickets.example.com/q/synthetic.png",
};

/** Count searches, rather than impose a machine-dependent timing assertion. */
function countTagSearches(run: () => void): number {
  const search = vi.spyOn(String.prototype, "indexOf");
  try {
    run();
    return search.mock.calls.filter(([needle]) => needle === "<").length;
  } finally {
    search.mockRestore();
  }
}

describe("large repetitive templates", () => {
  it("validates a near-limit template with a bounded number of tag searches", () => {
    expect(html.length).toBeGreaterThan(180_000);
    expect(html.length).toBeLessThan(200_000);
    const searches = countTagSearches(() => assertValidTemplate({ subject: input.subject, body: html }));
    expect(searches).toBeLessThanOrEqual(count * 2 + 4);
  });

  it.each([
    { name: "ordinary", render: renderTemplate },
    { name: "trusted", render: renderTemplateTrusted },
    { name: "trusted-storage", render: renderTemplateTrustedForStorage },
  ])("renders $name without replaying earlier tags", ({ render }) => {
    const searches = countTagSearches(() => {
      const result = render(input, vars);
      expect(result.html.match(/Synthetic&quot; guest/g)).toHaveLength(count);
    });
    expect(searches).toBeLessThanOrEqual(count * 4 + 8);
  });

  it("materializes many deferred links without replaying earlier tags", () => {
    const frozen = { subject: "Synthetic", html: '<a href="{{ticket_url}}">Ticket</a>'.repeat(count) };
    const searches = countTagSearches(() => {
      const result = materializeStoredDeliveryMessage(frozen, {
        ...vars, apple_wallet_url: "", google_wallet_url: "",
      });
      expect(result.html.match(/href="https:\/\/tickets.example.com\/t\/synthetic"/g)).toHaveLength(count);
    });
    expect(searches).toBeLessThanOrEqual(count * 2 + 4);
  });

  it("does not repeatedly search a text-only suffix or future tag", () => {
    const text = '<!-- finished -->' + '{{first_name}} '.repeat(count) + '<p>{{ticket_url}} {{qr_image_url}}</p>';
    const searches = countTagSearches(() => {
      const result = renderTemplate({ subject: "Synthetic", compiledHtml: text }, vars);
      expect(result.html.match(/Synthetic" guest/g)).toHaveLength(count);
    });
    expect(searches).toBeLessThanOrEqual(8);
  });
  it("advances past many literal text openers without replaying the prefix", () => {
    const repetitions = 2_000;
    const text = '<p>note < x="open</p><span title="{{first_name}}">Guest</span>'.repeat(repetitions) +
      '<p>{{ticket_url}} {{qr_image_url}}</p>';
    expect(text.length).toBeLessThan(200_000);
    const searches = countTagSearches(() => {
      const result = renderTemplate({ subject: "Synthetic", compiledHtml: text }, vars);
      expect(result.html.match(/title="Synthetic&quot; guest"/g)).toHaveLength(repetitions);
    });
    expect(searches).toBeLessThanOrEqual(repetitions * 10 + 8);
  });

});
