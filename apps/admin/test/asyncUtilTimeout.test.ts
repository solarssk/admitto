import { getConfig } from "@testing-library/dom";
import { describe, expect, it } from "vitest";

describe("the wait of findBy* and waitFor", () => {
  it("is four seconds, set once for every test project by test/asyncUtilTimeout.ts", () => {
    expect(getConfig().asyncUtilTimeout).toBe(4000);
  });
});
