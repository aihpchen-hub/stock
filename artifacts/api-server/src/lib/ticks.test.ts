import { describe, expect, it } from "vitest";

import { roundToTick, tickSize } from "./ticks";

describe("tickSize", () => {
  it("依證交所級距分段", () => {
    expect(tickSize(9.99)).toBe(0.01);
    expect(tickSize(10)).toBe(0.05);
    expect(tickSize(49.95)).toBe(0.05);
    expect(tickSize(50)).toBe(0.1);
    expect(tickSize(99.9)).toBe(0.1);
    expect(tickSize(100)).toBe(0.5);
    expect(tickSize(499.5)).toBe(0.5);
    expect(tickSize(500)).toBe(1);
    expect(tickSize(999)).toBe(1);
    expect(tickSize(1000)).toBe(5);
    expect(tickSize(2500)).toBe(5);
  });
});

describe("roundToTick", () => {
  it("千元以上取整到 5 元 —— 這是原本算出 2040.43 的問題", () => {
    expect(roundToTick(2040.43)).toBe(2040);
    expect(roundToTick(2723.28)).toBe(2725);
  });

  it("各級距取到最近的合法檔位", () => {
    expect(roundToTick(8.123)).toBe(8.12);
    expect(roundToTick(23.47)).toBe(23.45);
    expect(roundToTick(87.53)).toBe(87.5);
    expect(roundToTick(436.14)).toBe(436);
    expect(roundToTick(672.34)).toBe(672);
  });

  it("結果一定是該價位檔位的整數倍", () => {
    for (const price of [3.333, 27.77, 63.21, 251.9, 777.7, 1234.5, 2381.86]) {
      const r = roundToTick(price);
      const tick = tickSize(r);
      // 以整數運算避免浮點餘數誤判
      expect(Math.round(r * 100) % Math.round(tick * 100)).toBe(0);
    }
  });

  it("誤差不超過半個檔位", () => {
    for (const price of [8.123, 23.47, 87.53, 436.14, 672.34, 2040.43]) {
      expect(Math.abs(roundToTick(price) - price)).toBeLessThanOrEqual(tickSize(price) / 2 + 1e-9);
    }
  });

  it("跨級距取整後仍是合法價格", () => {
    // 49.98 落在 0.05 檔位 → 50，而 50 在新級距（0.1）下也合法
    expect(roundToTick(49.98)).toBe(50);
    expect(roundToTick(99.97)).toBe(100);
    expect(roundToTick(499.8)).toBe(500);
    expect(roundToTick(999.6)).toBe(1000);
  });

  it("已在檔位上的價格不變", () => {
    for (const price of [8.12, 23.45, 87.5, 436, 672, 2040]) {
      expect(roundToTick(price)).toBe(price);
    }
  });

  it("非正值或非數值原樣回傳，不製造假價格", () => {
    expect(roundToTick(0)).toBe(0);
    expect(roundToTick(-5)).toBe(-5);
    expect(Number.isNaN(roundToTick(Number.NaN))).toBe(true);
  });
});
