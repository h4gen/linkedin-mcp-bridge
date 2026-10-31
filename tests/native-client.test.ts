import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:net", () => ({ default: { connect: mocks.connect } }));
vi.mock("../src/native/access.js", () => ({
  transportToken: async () => "test-token",
}));
import { call } from "../src/native/client.js";
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
function socket() {
  return Object.assign(new EventEmitter(), {
    write: vi.fn(),
    destroy: vi.fn(),
  });
}
it("waits for host recovery before dispatch and sends exactly once", async () => {
  vi.useFakeTimers();
  const failed = socket(),
    ready = socket();
  mocks.connect.mockReturnValueOnce(failed).mockReturnValueOnce(ready);
  const result = call("health", {});
  await vi.advanceTimersByTimeAsync(0);
  failed.emit(
    "error",
    Object.assign(Error("refused"), { code: "ECONNREFUSED" }),
  );
  await vi.advanceTimersByTimeAsync(250);
  ready.emit("connect");
  const request = JSON.parse(ready.write.mock.calls[0][0]);
  ready.emit(
    "data",
    Buffer.from(
      JSON.stringify({ id: request.id, result: { connected: true } }) + "\n",
    ),
  );
  expect(await result).toEqual({ connected: true });
  expect(failed.write).not.toHaveBeenCalled();
  expect(ready.write).toHaveBeenCalledTimes(1);
});
it.each(["error", "end"])(
  "never replays a dispatched write after socket %s",
  async (event) => {
    vi.useFakeTimers();
    const s = socket();
    mocks.connect.mockReturnValue(s);
    const result = call("message_send", {}).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    s.emit("connect");
    s.emit(event, Object.assign(Error("reset"), { code: "ECONNRESET" }));
    expect((await result).message).toBe("bridge_disconnected_unknown_outcome");
    await vi.advanceTimersByTimeAsync(30000);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(s.write).toHaveBeenCalledTimes(1);
  },
);
it("bounds unavailable-host retries and reports transport stage", async () => {
  vi.useFakeTimers();
  mocks.connect.mockImplementation(() => {
    const s = socket();
    setTimeout(
      () => s.emit("error", Object.assign(Error(), { code: "ENOENT" })),
      0,
    );
    return s;
  });
  const result = call("health", {}).catch((e) => e);
  await vi.advanceTimersByTimeAsync(11000);
  const error = await result;
  expect(error.message).toBe("native_host_unavailable");
  expect(error.details).toEqual({
    stage: "transport",
    cause: "ENOENT",
    dispatch_state: "not_dispatched",
  });
  expect(mocks.connect.mock.calls.length).toBeLessThan(12);
});
it("cancellation stops pre-dispatch retry", async () => {
  vi.useFakeTimers();
  const s = socket();
  mocks.connect.mockReturnValue(s);
  const controller = new AbortController();
  const result = call("health", {}, controller.signal).catch((e) => e);
  await vi.advanceTimersByTimeAsync(0);
  s.emit("error", Object.assign(Error(), { code: "ENOENT" }));
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  expect((await result).message).toBe("cancelled");
  expect(mocks.connect).toHaveBeenCalledTimes(1);
});
