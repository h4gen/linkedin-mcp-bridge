import { it, expect } from "vitest";
import vm from "node:vm";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  NativeMessageDecoder,
  encodeNativeMessage,
} from "../src/native/framing.js";
it("boots the actual MV3 bundle without Node dependencies", async () => {
  const listeners: Function[] = [];
  const area = {
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
  };
  const chrome = {
    storage: { local: area, session: area },
    runtime: {
      onMessage: { addListener: (fn: Function) => listeners.push(fn) },
    },
    alarms: {
      create: () => {},
      onAlarm: { addListener: (fn: Function) => listeners.push(fn) },
    },
  };
  vm.runInNewContext(
    await fs.readFile("dist/extension/background.js", "utf8"),
    {
      chrome,
      console,
      crypto: globalThis.crypto,
      setTimeout,
      clearTimeout,
      TextEncoder,
      URLSearchParams,
    },
  );
  expect(listeners).toHaveLength(2);
  const manifest = JSON.parse(
    await fs.readFile("dist/extension/manifest.json", "utf8"),
  );
  expect(manifest.host_permissions).toEqual(["https://www.linkedin.com/*"]);
  expect(manifest.permissions).not.toContain("cookies");
});
it("serves all typed tools through actual MCP stdio", async () => {
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js", "mcp"],
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    expect(result.tools).toHaveLength(26);
    expect(result.tools.some((x) => x.name === "linkedin_message_send")).toBe(
      true,
    );
  } finally {
    await client.close();
  }
});
it("installs isolated native manifest and round-trips a real native/socket frame", async () => {
  const home = await fs.mkdtemp("/tmp/li-mcp-");
  const env = { ...process.env, HOME: home };
  let host: ReturnType<typeof spawn> | undefined;
  let client: net.Socket | undefined;
  try {
    const installer = spawn(
      process.execPath,
      ["dist/cli.js", "install", "a".repeat(32)],
      { env, stdio: ["ignore", "pipe", "pipe"] },
    );
    expect((await once(installer, "exit"))[0]).toBe(0);
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(
          home,
          "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.hagen.linkedin_mcp_bridge.json",
        ),
        "utf8",
      ),
    );
    const launcher = await fs.readFile(manifest.path, "utf8");
    expect(launcher).toContain("/dist/host.js");
    host = spawn(process.execPath, ["dist/host.js"], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const socket = path.join(
      home,
      "Library/Application Support/LinkedIn MCP Bridge/bridge.sock",
    );
    for (let i = 0; i < 100; i++) {
      if (await fs.stat(socket).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect((await fs.stat(socket)).mode & 0o777).toBe(0o600);
    client = net.connect(socket);
    await once(client, "connect");
    const decoder = new NativeMessageDecoder();
    const nativeReply = new Promise<any>((resolve) =>
      host!.stdout!.on("data", (b) => {
        for (const msg of decoder.push(b)) resolve(msg);
      }),
    );
    client.write(
      JSON.stringify({ id: "caller-id", op: "health", args: {} }) + "\n",
    );
    const request = await nativeReply;
    expect(request.id).not.toBe("caller-id");
    expect(request.op).toBe("health");
    const result = once(client, "data");
    host.stdin!.write(
      encodeNativeMessage({ id: request.id, result: { connected: true } }),
    );
    expect(JSON.parse(String((await result)[0]))).toEqual({
      id: "caller-id",
      result: { connected: true },
    });
  } finally {
    client?.destroy();
    if (host) {
      host.stdin?.end();
      if (host.exitCode === null) await once(host, "exit");
    }
    await fs.rm(home, { recursive: true, force: true });
  }
}, 10000);
