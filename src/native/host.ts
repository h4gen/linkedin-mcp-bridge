import { VERSION, PROTOCOL, CHANNEL } from "../version.js";
import { StringDecoder } from "node:string_decoder";
import net from "node:net";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { encodeNativeMessage, NativeMessageDecoder } from "./framing.js";
import { prepareAccess, transportToken } from "./access.js";
import { root, socketPath } from "./paths.js";
import { parse, writes, type Operation } from "../core/contracts.js";
await prepareAccess();
const token = await transportToken();
const lockPath = root + "/host.lock";
try {
  const lock = await fs.open(lockPath, "wx", 0o600);
  await lock.writeFile(String(process.pid));
  await lock.close();
} catch (e: any) {
  if (e.code !== "EEXIST") throw e;
  // Only one contender may recover a stale lock. A newly acquired lock is never removed.
  const recovery = root + "/host-lock-recovery";
  try {
    await fs.mkdir(recovery, { mode: 0o700 });
  } catch {
    process.exit(1);
  }
  try {
    const pid = Number(await fs.readFile(lockPath, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw Error("Invalid host lock; inspect it before removing.");
    try {
      process.kill(pid, 0);
      throw Error("Native host already running.");
    } catch (err: any) {
      if (err.code !== "ESRCH") throw err;
    }
    await fs.unlink(lockPath);
    const lock = await fs.open(lockPath, "wx", 0o600);
    await lock.writeFile(String(process.pid));
    await lock.close();
  } finally {
    await fs.rmdir(recovery);
  }
}
// Probe before removing a stale socket: another Chrome profile must not steal it.
const alive = await new Promise<boolean>((resolve) => {
  const p = net.connect(socketPath);
  p.once("connect", () => {
    p.destroy();
    resolve(true);
  });
  p.once("error", () => resolve(false));
  p.setTimeout(1000, () => {
    p.destroy();
    resolve(true);
  });
});
if (alive) {
  await fs.unlink(lockPath);
  process.exit(1);
}
if (process.platform !== "win32")
  await fs.unlink(socketPath).catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
const owners = new Map<
  string,
  { socket: net.Socket; client: net.Socket; timer: NodeJS.Timeout }
>();
const clients = new Set<net.Socket>();
const server = net.createServer((socket) => {
  clients.add(socket);
  let buffer = "";
  const textDecoder = new StringDecoder("utf8");
  let outstanding = 0;
  socket.on("data", (chunk) => {
    buffer += textDecoder.write(chunk);
    if (Buffer.byteLength(buffer) > 1024 * 1024) {
      socket.destroy();
      return;
    }
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const msg = JSON.parse(line);
        if (
          typeof msg.id !== "string" ||
          msg.id.length > 100 ||
          outstanding >= 8
        )
          throw Error("bad_request");
        if (token && msg.token !== token)
          throw Error("unauthorized_local_client");
        delete msg.token;
        parse(msg.op, msg.args);
        const wireId = randomUUID();
        outstanding++;
        const timer = setTimeout(() => {
          owners.delete(wireId);
          process.stdout.write(encodeNativeMessage({ cancel: wireId }));
          outstanding--;
          if (!socket.destroyed)
            socket.write(
              JSON.stringify({
                id: msg.id,
                error: {
                  code: writes.has(msg.op as Operation)
                    ? "timeout_unknown_outcome"
                    : "timeout",
                },
              }) + "\n",
            );
        }, 65000);
        // Wire IDs are host-generated so clients cannot intercept each other's replies.
        const proxy = {
          write: (response: string) => {
            const decoded = JSON.parse(response);
            decoded.id = msg.id;
            outstanding--;
            socket.write(JSON.stringify(decoded) + "\n");
          },
          get destroyed() {
            return socket.destroyed;
          },
        } as net.Socket;
        owners.set(wireId, { socket: proxy, client: socket, timer });
        process.stdout.write(
          encodeNativeMessage({
            ...msg,
            protocol: PROTOCOL,
            hostVersion: VERSION,
            id: wireId,
            deadline: Date.now() + 60000,
          }),
        );
      } catch {
        socket.destroy();
        return;
      }
    }
  });
  socket.on("error", () => {});
  socket.on("close", () => {
    clients.delete(socket);
    for (const [id, o] of owners)
      if (o.client === socket) {
        clearTimeout(o.timer);
        owners.delete(id);
        process.stdout.write(encodeNativeMessage({ cancel: id }));
      }
  });
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, resolve);
});
if (process.platform !== "win32") await fs.chmod(socketPath, 0o600);
const decoder = new NativeMessageDecoder();
process.stdin.on("data", (chunk) => {
  try {
    for (const m of decoder.push(chunk)) {
      const msg = m as any;
      if (msg?.type === "hello") {
        process.stdout.write(
          encodeNativeMessage({
            type: "hello",
            protocol: PROTOCOL,
            hostVersion: VERSION,
            channel: CHANNEL,
          }),
        );
        continue;
      }
      const owner = owners.get(msg.id);
      if (!owner) continue;
      clearTimeout(owner.timer);
      owners.delete(msg.id);
      if (!owner.socket.destroyed)
        owner.socket.write(JSON.stringify(msg) + "\n");
    }
  } catch {
    void shutdown();
  }
});
async function shutdown() {
  for (const { timer } of owners.values()) clearTimeout(timer);
  for (const c of clients) c.destroy();
  server.close();
  if (process.platform !== "win32") await fs.unlink(socketPath).catch(() => {});
  await fs.unlink(lockPath).catch(() => {});
  process.exit(0);
}
process.stdin.on("end", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
