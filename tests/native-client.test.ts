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
  await vi.advanceTimersByTimeAsync(36000);
  const error = await result;
  expect(error.message).toBe("native_host_unavailable");
  expect(error.details).toEqual({
    stage: "transport",
    cause: "ENOENT",
    dispatch_state: "not_dispatched",
  });
  expect(mocks.connect.mock.calls.length).toBeLessThan(25);
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

it("recovers an interrupted API read once, while retaining its exact arguments", async () => {
  vi.useFakeTimers();
  const first = socket(),
    recovered = socket();
  mocks.connect.mockReturnValueOnce(first).mockReturnValue(recovered);
  const args = {
    account_urn: "urn:li:fsd_profile:me",
    limit: 2,
    cursor: "same-cursor",
  };
  const pending = call("conversations_list", args).catch((e) => e);
  await vi.advanceTimersByTimeAsync(0);
  first.emit("connect");
  first.emit("end");
  await vi.advanceTimersByTimeAsync(250);
  expect(mocks.connect).toHaveBeenCalledTimes(2);
  recovered.emit("connect");
  const request = JSON.parse(recovered.write.mock.calls[0][0]);
  expect(request.args).toEqual(args);
  recovered.emit(
    "data",
    Buffer.from(
      JSON.stringify({ id: request.id, result: { items: [] } }) + "\n",
    ),
  );
  expect(await pending).toEqual({ items: [] });
});
it("waits through the extension's maximum 30-second reconnect backoff", async () => {
  vi.useFakeTimers();
  const start = Date.now();
  mocks.connect.mockImplementation(() => {
    const s = socket();
    setTimeout(() => {
      if (Date.now() - start < 30000)
        s.emit("error", Object.assign(Error(), { code: "ENOENT" }));
      else {
        s.emit("connect");
        const r = JSON.parse(s.write.mock.calls[0][0]);
        s.emit(
          "data",
          Buffer.from(
            JSON.stringify({ id: r.id, result: { connected: true } }) + "\n",
          ),
        );
      }
    }, 0);
    return s;
  });
  const pending = call("health", {}).catch((e) => e);
  await vi.advanceTimersByTimeAsync(36000);
  expect(await pending).toEqual({ connected: true });
});

it.each(["feed_list", "reactions_list", "post_draft_create", "post_schedule"])(
  "never replays stateful DOM operation %s",
  async (op) => {
    vi.useFakeTimers();
    const s = socket();
    mocks.connect.mockReturnValue(s);
    const pending = call(op, {}).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    s.emit("connect");
    s.emit("end");
    expect((await pending).message).toMatch(/^bridge_disconnected/);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
  },
);
it("stops after one API replay if the second host also disconnects", async () => {
  vi.useFakeTimers();
  const a = socket(),
    b = socket();
  mocks.connect.mockReturnValueOnce(a).mockReturnValue(b);
  const pending = call("health", {}).catch((e) => e);
  await vi.advanceTimersByTimeAsync(0);
  a.emit("connect");
  a.emit("end");
  await vi.advanceTimersByTimeAsync(250);
  b.emit("connect");
  b.emit("end");
  expect((await pending).message).toBe("bridge_disconnected");
  await vi.advanceTimersByTimeAsync(35000);
  expect(mocks.connect).toHaveBeenCalledTimes(2);
});
it("reports an unknown write outcome for a corrupted host response", async () => {
  vi.useFakeTimers();
  const s = socket();
  mocks.connect.mockReturnValue(s);
  const pending = call("message_send", {}).catch((e) => e);
  await vi.advanceTimersByTimeAsync(0);
  s.emit("connect");
  s.emit("data", Buffer.from("corrupted\n"));
  expect((await pending).message).toBe("invalid_host_response_unknown_outcome");
  expect(mocks.connect).toHaveBeenCalledTimes(1);
});
