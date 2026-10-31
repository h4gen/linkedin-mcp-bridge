import { capabilities } from "../core/capabilities.js";
import { writes, type Operation } from "../core/contracts.js";
import { StringDecoder } from "node:string_decoder";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { transportToken } from "./access.js";
import { socketPath } from "./paths.js";
export async function call(
  op: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<any> {
  const token = await transportToken().catch(() => {
    throw Error("bridge_unavailable_open_extension");
  });
  const outcome = writes.has(op as Operation) ? "_unknown_outcome" : "";
  // Opening a socket is always retryable. Only idempotent API reads and health
  // may also be replayed once after transport loss; DOM traversals and writes never are.
  const safeRead =
    op === "health" ||
    (capabilities[op as Operation]?.adapter === "api" &&
      !writes.has(op as Operation));
  let replayedRead = false;
  const deadline = Date.now() + 70000;
  const until = Date.now() + 35000; // Covers the extension's capped 30-second backoff.
  let delay = 250;
  while (true) {
    try {
      return await exchange();
    } catch (e) {
      const retryRead =
        safeRead &&
        !replayedRead &&
        e instanceof Error &&
        e.message === "bridge_disconnected";
      if (
        (!(e as any)?.beforeDispatch && !retryRead) ||
        Date.now() >= until ||
        signal?.aborted
      )
        throw e;
      if (retryRead) replayedRead = true;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(delay, until - Date.now()));
        signal?.addEventListener("abort", done, { once: true });
      });
      delay = Math.min(delay * 2, 2000);
    }
  }
  function exchange() {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(Error("cancelled"));
        return;
      }
      const socket = net.connect(socketPath);
      let dispatched = false;
      let finished = false;
      let buf = "";
      const textDecoder = new StringDecoder("utf8");
      const id = randomUUID();
      const finish = (err?: Error, result?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        socket.destroy();
        err ? reject(err) : resolve(result);
      };
      const abort = () => finish(Error("cancelled" + outcome));
      const timer = setTimeout(
        () => finish(Error("timeout" + outcome)),
        Math.max(0, deadline - Date.now()),
      );
      signal?.addEventListener("abort", abort, { once: true });
      socket.once("connect", () => {
        if (finished) return;
        dispatched = true;
        socket.write(JSON.stringify({ id, op, args, token }) + "\n");
      });
      socket.on("data", (b) => {
        buf += textDecoder.write(b);
        if (buf.length > 8 * 1024 * 1024) {
          finish(Error("response_too_large" + outcome));
          return;
        }
        const i = buf.indexOf("\n");
        if (i < 0) return;
        try {
          const reply = JSON.parse(buf.slice(0, i));
          if (reply.id !== id) return;
          reply.error
            ? finish(
                Object.assign(Error(reply.error.code), {
                  details: reply.error,
                }),
              )
            : finish(undefined, reply.result);
        } catch {
          finish(Error("invalid_host_response" + outcome));
        }
      });
      socket.on("error", (e: NodeJS.ErrnoException) =>
        finish(
          dispatched
            ? Error("bridge_disconnected" + outcome)
            : Object.assign(Error("native_host_unavailable"), {
                beforeDispatch: ["ENOENT", "ECONNREFUSED"].includes(
                  e.code ?? "",
                ),
                details: {
                  stage: "transport",
                  cause: e.code,
                  dispatch_state: "not_dispatched",
                },
              }),
        ),
      );
      socket.on("end", () => finish(Error("bridge_disconnected" + outcome)));
    });
  }
}
