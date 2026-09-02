import { describe, expect, it } from "vitest";
import { niceCountAxis, yAxisWidthForCount } from "../../src/pages/reports-charts.js";

describe("niceCountAxis", () => {
  it("gives a small max (<=1) one tick of headroom instead of pinning the line to the ceiling", () => {
    expect(niceCountAxis(0)).toEqual({ axisMax: 2, tickAmount: 2 });
    expect(niceCountAxis(1)).toEqual({ axisMax: 2, tickAmount: 2 });
  });

  it("rounds up to the nearest 1-2-5-10 'nice' step for a mid-size count", () => {
    expect(niceCountAxis(8)).toEqual({ axisMax: 8, tickAmount: 4 });
    expect(niceCountAxis(45)).toEqual({ axisMax: 50, tickAmount: 5 });
  });

  it("clamps the step to at least 1 so counts (always whole numbers) never get a fractional tick", () => {
    const { axisMax, tickAmount } = niceCountAxis(3);
    expect(Number.isInteger(axisMax / tickAmount)).toBe(true);
    expect(axisMax / tickAmount).toBeGreaterThanOrEqual(1);
  });

  it("scales the same way for a large count", () => {
    expect(niceCountAxis(950)).toEqual({ axisMax: 1000, tickAmount: 5 });
  });
});

describe("yAxisWidthForCount", () => {
  it("widens the axis gutter as the tick label grows more digits", () => {
    const oneDigit = yAxisWidthForCount(2);
    const threeDigit = yAxisWidthForCount(200);
    const fourDigit = yAxisWidthForCount(2000);
    expect(oneDigit).toBeLessThan(threeDigit);
    expect(threeDigit).toBeLessThan(fourDigit);
  });

  it("always includes the fixed tick-mark/label padding on top of the measured digit width", () => {
    expect(yAxisWidthForCount(2)).toBe(Math.ceil("2".length * 6.5) + 16);
  });
});
