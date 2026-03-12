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

describe("fee calculation", () => {
  const calculateFees = (amount: number) => {
    const surerFee = Math.min(amount * 0.015, 700);
    const payscrowFee = Math.min(amount * 0.02 + 100, 1000);
    return { surerFee, payscrowFee, total: surerFee + payscrowFee };
  };

  it("calculates fees correctly for ₦10,000", () => {
    const fees = calculateFees(10000);
    expect(fees.surerFee).toBe(150);
    expect(fees.payscrowFee).toBe(300);
    expect(fees.total).toBe(450);
  });

  it("caps surer fee at ₦700", () => {
    const fees = calculateFees(100000);
    expect(fees.surerFee).toBe(700);
  });

  it("caps payscrow fee at ₦1,000", () => {
    const fees = calculateFees(100000);
    expect(fees.payscrowFee).toBe(1000);
  });
});

describe("decision logic", () => {
  const needsReason = (t: string) => ["release_specific", "refund", "reject"].includes(t);

  it("identifies types needing reason correctly", () => {
    expect(needsReason("release_specific")).toBe(true);
    expect(needsReason("refund")).toBe(true);
    expect(needsReason("reject")).toBe(true);
    expect(needsReason("release_all")).toBe(false);
    expect(needsReason("delivered")).toBe(false);
    expect(needsReason("accept")).toBe(false);
  });

  it("decision combinations resolve correctly", () => {
    const getOutcome = (sender: string | null, receiver: string | null, status: string) => {
      if (status === "active") {
        if (sender === "release_all" && receiver === "delivered") return "completed";
        if ((sender === "release_specific" || sender === "refund") && receiver === "accept") return "completed";
        if ((sender === "release_specific" || sender === "refund") && receiver === "reject") return "dispute";
        if ((sender && !receiver) || (!sender && receiver)) return "auto_execute_2days";
        return "active";
      }
      if (status === "dispute") {
        if (sender === "release_all") return "completed";
        if ((sender === "release_specific" || sender === "refund") && receiver === "accept") return "completed";
        return "dispute";
      }
      return status;
    };

    expect(getOutcome("release_all", "delivered", "active")).toBe("completed");
    expect(getOutcome("release_specific", "accept", "active")).toBe("completed");
    expect(getOutcome("refund", "accept", "active")).toBe("completed");
    expect(getOutcome("release_specific", "reject", "active")).toBe("dispute");
    expect(getOutcome("refund", "reject", "active")).toBe("dispute");
    expect(getOutcome("release_all", null, "active")).toBe("auto_execute_2days");
    expect(getOutcome(null, "delivered", "active")).toBe("auto_execute_2days");
    expect(getOutcome("release_all", "reject", "dispute")).toBe("completed");
    expect(getOutcome("release_specific", "accept", "dispute")).toBe("completed");
    expect(getOutcome("refund", "accept", "dispute")).toBe("completed");
    expect(getOutcome("release_specific", "reject", "dispute")).toBe("dispute");
    expect(getOutcome("refund", "reject", "dispute")).toBe("dispute");
  });
});
