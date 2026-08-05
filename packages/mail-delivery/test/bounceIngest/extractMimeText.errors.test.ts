import { beforeEach, describe, expect, it, vi } from "vitest";

const { parseHeaderValueMock, actualParseHeaderValue } = vi.hoisted(() => {
  // Filled in the mock factory after importing the real module.
  return {
    parseHeaderValueMock: vi.fn(),
    actualParseHeaderValue: { current: null as null | ((value: string) => unknown) },
  };
});

vi.mock("libmime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("libmime")>();
  const base = (actual as { default?: typeof actual }).default ?? actual;
  actualParseHeaderValue.current = base.parseHeaderValue.bind(base);
  parseHeaderValueMock.mockImplementation((value: string) =>
    actualParseHeaderValue.current!(value),
  );
  return {
    ...actual,
    default: {
      ...base,
      parseHeaderValue: (value: string) => parseHeaderValueMock(value),
      decodeWords: base.decodeWords.bind(base),
    },
  };
});

describe("extractPlainTextFromSource MIME walk errors", () => {
  beforeEach(() => {
    parseHeaderValueMock.mockReset();
    parseHeaderValueMock.mockImplementation((value: string) =>
      actualParseHeaderValue.current!(value),
    );
  });

  it("falls back when MIME header parsing throws during the walk", async () => {
    parseHeaderValueMock.mockImplementationOnce(() => {
      throw new Error("corrupt content-type");
    });
    const { extractPlainTextFromSource } = await import(
      "../../src/bounceIngest/extractMimeText.js"
    );
    const source = [
      "Content-Type: text/plain; charset=utf-8",
      "",
      "user@example.com failed: host mx.example.com said: 550 5.1.1 User unknown",
    ].join("\r\n");
    const text = extractPlainTextFromSource(source);
    expect(text).toContain("550 5.1.1");
  });
});
