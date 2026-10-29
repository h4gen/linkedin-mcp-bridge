import { describe, it, expect } from "vitest";
// @ts-expect-error build scripts are plain JavaScript
import { testWrites } from "../scripts/test-writes.mjs";
describe("local mutation acceptance builds", () => {
  it("rejects test capabilities in distributable builds", () => {
    expect(() => testWrites("pilot", "invitation_send")).toThrow();
    expect(testWrites("pilot", "")).toEqual([]);
  });
  it("only enables explicitly selected supported tests", () => {
    expect(testWrites("development")).toEqual([]);
    expect(
      testWrites("development", "invitation_send,invitation_send"),
    ).toEqual(["invitation_send"]);
    expect(() => testWrites("development", "post_create")).toThrow();
    expect(() => testWrites("development", "*")).toThrow();
  });
});
