// Chromium uses asymmetric Native Messaging limits: a native host may send at
// most 1 MiB to the extension, while messages sent by the extension to the host
// may be up to 64 MiB. Planner Discovery responses travel Chrome -> host and
// can legitimately exceed 1 MiB.
export const MAX_NATIVE_HOST_TO_CHROME_BYTES = 1024 * 1024;
export const MAX_CHROME_TO_NATIVE_HOST_BYTES = 64 * 1024 * 1024;

export function encodeNativeMessage(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > MAX_NATIVE_HOST_TO_CHROME_BYTES)
    throw new Error("Native host message exceeds Chrome's 1 MiB limit.");
  const frame = Buffer.allocUnsafe(payload.length + 4);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

export class NativeMessageDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): unknown[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0);
      if (length > MAX_CHROME_TO_NATIVE_HOST_BYTES)
        throw new Error("Chrome message exceeds the 64 MiB native-host limit.");
      if (this.buffer.length < length + 4) break;
      const payload = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      messages.push(JSON.parse(payload.toString("utf8")));
    }
    return messages;
  }
}
