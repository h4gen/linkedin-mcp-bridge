import { Args, Fault, Operation, parse, writes } from "./contracts.js";
import { Fetcher, graph, mutation, readApi, receipt } from "./api.js";
import { self } from "./normalize.js";
export interface Store {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface Deps {
  store: Store;
  fetch: Fetcher;
  dom: (op: Operation, args: Args, state: Args) => Promise<Args>;
  account: () => Promise<string | undefined>;
  now: () => number;
  uuid: () => string;
  hash: (text: string) => Promise<string>;
}
export class Engine {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private d: Deps) {}
  run(
    op: string,
    input: unknown,
    deadline = this.d.now() + 45000,
    cancelled = () => false,
  ): Promise<Args> {
    const task = this.tail.then(() =>
      this.execute(op as Operation, parse(op, input), deadline, cancelled),
    );
    this.tail = task.catch(() => {});
    return task;
  }
  private async execute(
    op: Operation,
    a: Args,
    deadline: number,
    cancelled: () => boolean,
  ): Promise<Args> {
    const d = this.d;
    const check = () => {
      if (cancelled()) throw new Fault("cancelled");
      if (d.now() > deadline) throw new Fault("deadline_exceeded");
    };
    check();
    const expected = await d.account();
    if (op === "health") {
      let usable = false;
      let error: string | undefined;
      if (expected) {
        try {
          usable = self(await d.fetch({ path: "/me" })) === expected;
          if (!usable) error = "account_changed";
        } catch (e) {
          error = e instanceof Fault ? e.code : "bridge_or_session_unavailable";
        }
      }
      return {
        version: "0.1.0",
        connected: usable,
        error,
        account_urn: expected ?? null,
        live_validation: "pending",
        transport: "local_native_messaging",
      };
    }
    if (!expected || a.account_urn !== expected)
      throw new Fault("account_mismatch");
    const actual = self(await d.fetch({ path: "/me" }));
    if (actual !== expected) throw new Fault("account_changed");
    const scope = await d.hash(
      JSON.stringify([
        op,
        { ...a, cursor: undefined, idempotency_key: undefined },
      ]),
    );
    const journal = (await d.store.get("journal")) ?? {};
    // Receipts have no message bodies or credentials. Pending survives restart as unknown.
    for (const [k, v] of Object.entries(journal) as [string, Args][])
      if (d.now() - v.created_at > 7 * 86400000) delete journal[k];
    await d.store.set("journal", journal);
    const key = await d.hash(`${expected}:${a.idempotency_key ?? ""}`);
    if (op === "operation_get") {
      const row = journal[key];
      if (!row) return { status: "not_found", retention_days: 7 };
      if (
        row.operation === "message_send" &&
        row.target?.startsWith("urn:li:msg_conversation:") &&
        row.status !== "confirmed"
      ) {
        const raw = await d.fetch(
          graph("messages", {
            deliveredAt: Date.now(),
            conversationUrn: row.target,
            countBefore: 50,
            countAfter: 0,
          }),
        );
        const match = (raw.included ?? []).find(
          (x: Args) =>
            x.originToken === row.origin_token &&
            typeof x.entityUrn === "string",
        );
        if (match) {
          row.status = "confirmed";
          row.receipt_id = match.entityUrn;
          await d.store.set("journal", journal);
        }
      }
      return {
        ...row,
        status: row.status === "pending" ? "unknown_outcome" : row.status,
      };
    }
    if (writes.has(op)) {
      if (journal[key]) {
        if (journal[key].fingerprint !== scope)
          throw new Fault("idempotency_conflict");
        return {
          ...journal[key],
          status:
            journal[key].status === "pending"
              ? "unknown_outcome"
              : journal[key].status,
          replayed: true,
        };
      }
      if (op === "message_send") {
        const wanted = [...a.expected_participant_urns].sort();
        if (a.recipient_urn) {
          if (JSON.stringify(wanted) !== JSON.stringify([a.recipient_urn]))
            throw new Fault("recipient_mismatch");
        } else {
          // Read list pages without opening the thread; do not silently mark messages read.
          let next: Args = {};
          let found: Args | undefined;
          for (let i = 0; i < 13 && !found; i++) {
            check();
            const page = await readApi(
              "conversations_list",
              { ...a, category: "INBOX", limit: 50 },
              next,
              d.fetch,
            );
            found = page.items.find(
              (x: Args) => x.entityUrn === a.conversation_urn,
            );
            if (!page.next) break;
            next = page.next;
          }
          if (!found)
            throw new Fault(
              "conversation_not_verified",
              "Conversation must be in the first 260 inbox entries for recipient validation.",
            );
          const participantList =
            found.conversationParticipants ?? found.participants ?? [];
          const participants = (
            Array.isArray(participantList)
              ? participantList
              : (participantList.elements ?? [])
          )
            .map(
              (p: Args) =>
                p.hostIdentityUrn ??
                p.participantType?.member?.entityUrn ??
                p.member?.entityUrn,
            )
            .filter((u: any) => u !== expected);
          if (
            participants.some((x: any) => typeof x !== "string") ||
            JSON.stringify([...new Set(participants)].sort()) !==
              JSON.stringify(wanted)
          )
            throw new Fault("recipient_mismatch");
        }
      }
      check();
      const origin = d.uuid();
      const row: Args = {
        operation: op,
        fingerprint: scope,
        account_urn: expected,
        created_at: d.now(),
        status: "pending",
        origin_token: origin,
        target:
          a.conversation_urn ??
          a.recipient_urn ??
          a.post_urn ??
          a.profile_urn ??
          a.invitation_urn,
      };
      journal[key] = row;
      await d.store.set("journal", journal); // durable before dispatch
      let dispatched = false;
      try {
        check();
        if (self(await d.fetch({ path: "/me" })) !== expected)
          throw new Fault("account_changed");
        check();
        if ((await d.account()) !== expected)
          throw new Fault("account_changed");
        const request = mutation(op, a, origin);
        dispatched = true;
        const result = request
          ? await d.fetch(request)
          : await d.dom(op, a, {});
        let verified = result?.verified === true;
        if (op === "conversation_update") {
          check();
          const category = a.action === "archive" ? "ARCHIVE" : "INBOX";
          let next: Args = {};
          for (let i = 0; i < 3; i++) {
            check();
            const page = await readApi(
              "conversations_list",
              { account_urn: expected, category, limit: 50 },
              next,
              d.fetch,
            );
            const thread = page.items.find(
              (x: Args) => x.entityUrn === a.conversation_urn,
            );
            if (thread) {
              verified =
                a.action === "read"
                  ? thread.read === true
                  : a.action === "unread"
                    ? thread.read === false
                    : Array.isArray(thread.categories) &&
                      (a.action === "archive"
                        ? thread.categories.includes("ARCHIVE")
                        : !thread.categories.includes("ARCHIVE"));
              break;
            }
            if (!page.next) break;
            next = page.next;
          }
        }
        const id = receipt(result) ?? result?.receipt_id;
        row.status = id || verified ? "confirmed" : "unknown_outcome";
        if (id) row.receipt_id = id;
      } catch (e) {
        row.status = dispatched ? "unknown_outcome" : "failed_before_dispatch";
        row.error = e instanceof Fault ? e.code : "transport_error";
      }
      await d.store.set("journal", journal);
      return row;
    }
    let state: Args = {};
    if (a.cursor) {
      const saved = await d.store.get("cursor:" + a.cursor);
      if (!saved || saved.scope !== scope || saved.expires < d.now())
        throw new Fault("invalid_cursor");
      state = saved.state;
    }
    check();
    const api = [
      "conversations_list",
      "conversations_search",
      "messages_list",
      "profile_get",
      "people_search",
      "invitations_list",
    ].includes(op);
    const result = api
      ? await readApi(op, a, state, d.fetch)
      : await d.dom(op, a, state);
    if (self(await d.fetch({ path: "/me" })) !== expected)
      throw new Fault("account_changed");
    if (result.next) {
      const token = d.uuid();
      await d.store.set("cursor:" + token, {
        scope,
        state: result.next,
        expires: d.now() + 1800000,
      });
      result.next_cursor = token;
      delete result.next;
    }
    return result;
  }
}
