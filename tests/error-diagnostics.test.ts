import { expect, it } from "vitest";
import { adapterDiagnostics } from "../src/core/errors.js";
it("preserves bounded target and cursor diagnostics without raw source leakage", () => {
  expect(
    adapterDiagnostics({
      reason: "path_changed",
      candidate_count: 3,
      matching_count: 0,
      path: "/private",
      dom: "secret",
      token: "secret",
    }),
  ).toEqual({ reason: "path_changed", candidate_count: 3, matching_count: 0 });
  expect(
    adapterDiagnostics({
      reason: "private arbitrary text",
      candidate_count: Infinity,
      matching_count: -1,
    }),
  ).toEqual({});
});
