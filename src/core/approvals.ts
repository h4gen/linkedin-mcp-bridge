import { Args, Fault, Operation } from "./contracts.js";
import type { Store } from "./engine.js";
export const ACCEPTED_WRITES: ReadonlySet<Operation> = new Set([
  "message_send",
  "conversation_update",
]);
export const APPROVAL_TTL = 30 * 60 * 1000;
export class Approvals {
  constructor(
    private store: Store,
    private now = Date.now,
    private uuid: () => string = () => crypto.randomUUID(),
  ) {}
  async request(
    op: Operation,
    args: Args,
    fingerprint: string,
    key: string,
  ): Promise<Args | undefined> {
    if (
      op === "conversation_update" &&
      (await this.store.get("allowInboxChanges")) === true
    )
      return;
    const name = "approval:" + key;
    const previous = await this.store.get(name);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new Fault("idempotency_conflict");
      if (previous.expires < this.now()) throw new Fault("approval_expired");
      if (previous.status === "approved") return;
      if (previous.status === "rejected") throw new Fault("approval_rejected");
      return {
        status: "approval_required",
        operation_id: previous.id,
        expires_at: previous.expires,
      };
    }
    const row = {
      id: this.uuid(),
      key,
      operation: op,
      args,
      fingerprint,
      status: "approval_required",
      expires: this.now() + APPROVAL_TTL,
    };
    await this.store.set(name, row);
    return {
      status: row.status,
      operation_id: row.id,
      expires_at: row.expires,
    };
  }
  // Called only by the extension-owned review UI, never exposed through MCP.
  async decide(key: string, id: string, approve: boolean) {
    const row = await this.store.get("approval:" + key);
    if (
      !row ||
      row.id !== id ||
      row.status !== "approval_required" ||
      row.expires < this.now()
    )
      throw new Fault("approval_unavailable");
    row.status = approve ? "approved" : "rejected";
    await this.store.set(
      "approval:" + key,
      approve ? row : { ...row, args: undefined },
    );
    return row;
  }
}
