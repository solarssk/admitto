import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { braceProp, openingTags, tsxFiles, withoutComments } from "./jsxScan.js";

/**
 * Drift guard for the buttons in the header of a card (standards/admin-spa/ui-gotchas.md): the `actions` slot of `Card` makes them small
 * (`.at-card__actions .at-btn` in `packages/ui`), so a `Button` written there does not pass `size="sm"`. A header that needs the large button
 * passes `size="lg"` on purpose. The look (primary, secondary, ghost) is still the call site's.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../src");

const REPEATED_SIZE = /(?<![\w-])size="sm"/;

interface HeaderButton {
  /** The line of the button, 1 based. */
  line: number;
  tag: string;
}

/** The `Button`s written in the `actions` prop of the `Card`s of a source. */
export function headerButtons(source: string): HeaderButton[] {
  const text = withoutComments(source);
  return openingTags(text, "Card").flatMap((card) => {
    const actions = braceProp(card.tag, "actions");
    if (!actions) return [];
    return openingTags(actions.text, "Button").map((button) => ({
      line: text.slice(0, card.start + actions.start + button.start).split("\n").length,
      tag: button.tag,
    }));
  });
}

const allHeaderButtons = tsxFiles(SRC).flatMap((file) => headerButtons(readFileSync(file, "utf8")).map((button) => ({ ...button, where: `${relative(SRC, file)}:${button.line}` })));

describe("the buttons in the header of a card (apps/admin/src)", () => {
  it("finds the buttons it is meant to check", () => {
    expect(allHeaderButtons.length).toBeGreaterThan(15);
  });

  it("none repeats size sm: the slot sets it", () => {
    const offenders = allHeaderButtons.filter(({ tag }) => REPEATED_SIZE.test(tag)).map(({ where }) => where);
    expect(
      offenders,
      'Leave size="sm" off a Button in the actions of a Card: the slot makes it small (.at-card__actions .at-btn in packages/ui). A header that needs the large one passes size="lg".',
    ).toEqual([]);
  });
});

describe("the scan of the buttons in a card header", () => {
  it("reads the buttons of the actions prop of a Card, inline and over several lines, inside a wrapper or a render prop", () => {
    const source = [
      "const a = (",
      '  <Card title="A" actions={<Button variant="secondary" size="sm">Add</Button>}>x</Card>',
      ");",
      "const b = (",
      "  <Card",
      '    title="B"',
      "    actions={",
      "      <ArchivedGuard>",
      "        {(guard) => (",
      "          <Tooltip>",
      "            <Button",
      '              variant="secondary"',
      '              size="sm"',
      "              onClick={() => go()}",
      "            >",
      "              Edit",
      "            </Button>",
      "          </Tooltip>",
      "        )}",
      "      </ArchivedGuard>",
      "    }",
      "  >",
      "    y",
      "  </Card>",
      ");",
    ].join("\n");
    const found = headerButtons(source);
    expect(found.map((button) => button.line)).toEqual([2, 11]);
    expect(found.every((button) => REPEATED_SIZE.test(button.tag))).toBe(true);
  });

  it("leaves out a button outside the actions, a Card without actions, a large button and a page header", () => {
    const source = [
      '<Card title="A"><Button size="sm">Inside the body</Button></Card>',
      '<Card title="B" actions={<Button size="lg">Large</Button>}>x</Card>',
      '<PageHeader title="C" actions={<Button size="sm">Page</Button>} />',
      '<Card title="D" actions={<Button variant="ghost">Plain</Button>}>y</Card>',
    ].join("\n");
    const found = headerButtons(source);
    expect(found.map((button) => REPEATED_SIZE.test(button.tag))).toEqual([false, false]);
    expect(found).toHaveLength(2);
  });

  it("does not read a comment as a button", () => {
    expect(headerButtons('<Card title="A" actions={null}>{/* <Button size="sm" /> */}</Card>')).toEqual([]);
  });
});
