import { describe, it, expect } from "vitest";

// helpers used by WebAuthn code
const bufToBase64 = (buffer: ArrayBuffer) => {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};
const base64ToBuf = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const len = binary.length;
  const buf = new Uint8Array(len);
  for (let i = 0; i < len; i++) buf[i] = binary.charCodeAt(i);
  return buf;
};

describe("example", () => {
  it("should pass", () => {
    expect(true).toBe(true);
  });
});

describe("webAuthn helpers", () => {
  it("round trips a Uint8Array", () => {
    const arr = new Uint8Array([1, 2, 3, 4, 255]);
    const b64 = bufToBase64(arr.buffer);
    const arr2 = base64ToBuf(b64);
    expect(Array.from(arr2)).toEqual(Array.from(arr));
  });
});

describe("spam fee calculation", () => {
  const getSpamFee = (amount: number) => {
    if (amount < 50000) return 100;
    if (amount < 500000) return 200;
    return 300;
  };

  it("returns ₦100 for small amounts", () => {
    expect(getSpamFee(1000)).toBe(100);
    expect(getSpamFee(49999)).toBe(100);
  });

  it("returns ₦200 for mid amounts", () => {
    expect(getSpamFee(50000)).toBe(200);
    expect(getSpamFee(499999)).toBe(200);
  });

  it("returns ₦300 for large amounts", () => {
    expect(getSpamFee(500000)).toBe(300);
    expect(getSpamFee(1000000)).toBe(300);
  });
});

describe("needsSpamFee helper", () => {
  const needsSpamFee = (t: string) => ["release_specific", "refund", "reject"].includes(t);

  it("identifies types correctly", () => {
    expect(needsSpamFee("release_specific")).toBe(true);
    expect(needsSpamFee("refund")).toBe(true);
    expect(needsSpamFee("reject")).toBe(true);
    expect(needsSpamFee("release_all")).toBe(false);
    expect(needsSpamFee("delivered")).toBe(false);
  });
});
