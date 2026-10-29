import { capabilities, capabilityStatus } from "./capabilities.js";
import { VERSION, PROTOCOL } from "../version.js";
import { Args, Fault, Operation, parse, writes } from "./contracts.js";
import {
  Fetcher,
  graph,
  mutation,
  readApi,
  receipt,
  getConversation,
  reconcileMessage,
  findInvitation,
} from "./api.js";
import { self, normalize } from "./normalize.js";
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
  cursorContext?: (op: Operation, state: Args) => Promise<void>;
  checkpoint?: () => Promise<void>;
  generation?: () => number;
  identity?: (urn: string) => Promise<Args | undefined>;
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
    const generation = this.d.generation?.();
    const task = this.tail.then(() =>
      this.execute(
        op as Operation,
        parse(op, input),
        deadline,
        () => cancelled() || this.d.generation?.() !== generation,
      ),
    );
    this.tail = task.catch(() => {});
    return task;
  }
  expireReceipts(): Promise<void> {
    const generation = this.d.generation?.();
    const task = this.tail.then(async () => {
      const journal = (await this.d.store.get("journal")) ?? {};
      for (const [key, value] of Object.entries(journal) as [string, Args][])
        if (this.d.now() - value.created_at > 7 * 86400000) delete journal[key];
      if (this.d.generation?.() === generation)
        await this.d.store.set("journal", journal);
    });
    this.tail = task.catch(() => {});
    return task;
  }
  private async execute(
    op: Operation,
    a: Args,
    deadline: number,
    cancelled: () => boolean,
  ): Promise<Args> {
    const d: Deps = {
      ...this.d,
      store: {
        ...this.d.store,
        set: async (key, value) => {
          check();
          await this.d.store.set(key, value);
        },
        remove: async (key) => {
          check();
          await this.d.store.remove(key);
        },
      },
      fetch: async (request) => {
        check();
        return this.d.fetch(request);
      },
    };
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
        version: VERSION,
        protocol: PROTOCOL,
        enabled_writes: [...writes],
        connected: usable,
        error,
        account_urn: expected ?? null,
        capabilities: capabilityStatus(usable),
        transport: "local_native_messaging",
      };
    }
    if (!expected || a.account_urn !== expected)
      throw new Fault("account_mismatch");
    if (op !== "operation_get") {
      const actual = self(await d.fetch({ path: "/me" }));
      if (actual !== expected) throw new Fault("account_changed");
    }
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
        ["pending", "unknown_outcome"].includes(row.status)
      ) {
        try {
          if (self(await d.fetch({ path: "/me" })) !== expected)
            throw new Fault("account_changed");
          const match = await reconcileMessage(row, d.fetch, check);
          if (match) {
            Object.assign(row, match, { status: "confirmed" });
            await d.store.set("journal", journal);
          } else row.reconciliation = "no_matching_receipt_observed";
        } catch (e) {
          row.reconciliation =
            e instanceof Fault ? e.code : "reconciliation_unavailable";
        }
      }
      return {
        ...row,
        status: row.status === "pending" ? "unknown_outcome" : row.status,
      };
    }
    if (writes.has(op)) {
      const previous = journal[key];
      const legacyCandidate =
        previous?.status === "unknown_outcome" &&
        !previous.dispatch_state &&
        ((op === "conversation_delete" &&
          previous.error === "conversation_pane_missing") ||
          (["invitation_respond", "invitation_withdraw"].includes(op) &&
            previous.error === "ui_control_ambiguous_or_missing"));
      if (previous) {
        if (previous.fingerprint !== scope)
          throw new Fault("idempotency_conflict");
        if (previous.status !== "failed_before_dispatch" && !legacyCandidate)
          return {
            ...previous,
            status:
              previous.status === "pending"
                ? "unknown_outcome"
                : previous.status,
            replayed: true,
          };
      }
      if (op === "message_send") {
        const wanted = [...a.expected_participant_urns].sort();
        if (a.recipient_urn) {
          if (JSON.stringify(wanted) !== JSON.stringify([a.recipient_urn]))
            throw new Fault("recipient_mismatch");
        } else {
          const found = await getConversation(a, d.fetch, check);
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
      let target: Args | undefined;
      if (["invitation_respond", "invitation_withdraw"].includes(op)) {
        target = await findInvitation(
          a,
          op === "invitation_withdraw" ? "sent" : "received",
          d.fetch,
          check,
        );
        if (!target) throw new Fault("invitation_not_verified");
      }
      if (op === "conversation_delete")
        target = await getConversation(a, d.fetch, check, {
          fields: ["conversationUrl"],
        });
      if (legacyCandidate) {
        // An exact source entity must still exist and its original failed control
        // path must be proven non-dispatching. Never infer this from absence.
        const proof = await d.dom(
          op,
          {
            ...a,
            verified_target: target,
            preflight: true,
            execution_deadline: deadline,
          },
          {},
        );
        check();
        if (
          !proof.preflight ||
          proof.dispatch_state !== "not_dispatched" ||
          !proof.legacy_no_dispatch_proof
        )
          return {
            ...previous,
            replayed: true,
            reconciliation: "legacy_dispatch_not_disproven",
          };
      }
      const actor =
        ["post_create", "post_comment"].includes(op) && d.identity
          ? await d.identity(expected)
          : undefined;
      if (
        ["post_create", "post_comment"].includes(op) &&
        d.identity &&
        !actor?.name
      )
        throw new Fault("actor_identity_unavailable");
      if (d.identity && op === "invitation_send") {
        const identity = await d.identity(a.profile_urn);
        if (!identity?.name) throw new Fault("recipient_identity_unavailable");
      }
      if (d.identity && op === "message_send") {
        for (const urn of a.expected_participant_urns) {
          const identity = await d.identity(urn);
          if (!identity?.name)
            throw new Fault("recipient_identity_unavailable");
        }
      }
      check();
      const origin = previous?.origin_token ?? d.uuid();
      const row: Args = {
        operation: op,
        version: VERSION,
        attempt_count: (previous?.attempt_count ?? (previous ? 1 : 0)) + 1,
        dispatch_state: "unknown",
        ...(previous
          ? {
              previous_attempts: [
                ...(previous.previous_attempts ?? []),
                {
                  status: previous.status,
                  error: previous.error,
                  dispatch_state: previous.dispatch_state ?? "unknown",
                  created_at: previous.created_at,
                  recovery: legacyCandidate
                    ? "verified_legacy_pre_dispatch_failure_and_current_target"
                    : "failed_before_dispatch",
                },
              ].slice(-10),
            }
          : {}),
        ...(op === "conversation_update" ? { action: a.action } : {}),
        fingerprint: scope,
        account_urn: expected,
        created_at: previous?.created_at ?? d.now(),
        last_attempt_at: d.now(),
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
      await d.checkpoint?.();
      await d.store.set("journal", journal); // durable before dispatch
      let dispatched = false;
      try {
        check();
        if (self(await d.fetch({ path: "/me" })) !== expected)
          throw new Fault("account_changed");
        check();
        if ((await d.account()) !== expected)
          throw new Fault("account_changed");
        await d.checkpoint?.();
        const request = mutation(op, a, origin);
        dispatched = true;
        const result = request
          ? await d.fetch(request)
          : await d.dom(
              op,
              {
                ...a,
                verified_target: target,
                verified_actor: actor,
                execution_deadline: deadline,
              },
              {},
            );
        row.dispatch_state = "dispatched";
        let verified = result?.verified === true;
        if (op === "conversation_update") {
          check();
          const thread = await getConversation(a, d.fetch, check, {
            fields: [
              a.action === "read" || a.action === "unread"
                ? "read"
                : "categories",
            ],
          });
          verified =
            a.action === "read"
              ? thread.read === true
              : a.action === "unread"
                ? thread.read === false
                : Array.isArray(thread.categories) &&
                  (a.action === "archive"
                    ? thread.categories.includes("ARCHIVE")
                    : !thread.categories.includes("ARCHIVE"));
        }

        if (
          [
            "invitation_withdraw",
            "invitation_respond",
            "conversation_delete",
          ].includes(op)
        ) {
          const uiVerified = verified;
          for (let attempt = 0; attempt < 4; attempt++) {
            check();
            if (op === "conversation_delete") {
              try {
                await getConversation(a, d.fetch, check, { mailboxOnly: true });
                verified = false;
              } catch (e) {
                if (
                  e instanceof Fault &&
                  e.code === "conversation_not_verified"
                )
                  verified = true;
                else throw e;
              }
            } else {
              const absent = !(await findInvitation(
                a,
                op === "invitation_withdraw" ? "sent" : "received",
                d.fetch,
                check,
              ));
              verified =
                absent &&
                (op !== "invitation_respond" ||
                  a.action !== "accept" ||
                  uiVerified);
            }
            if (verified) break;
            if (attempt < 3) await new Promise((r) => setTimeout(r, 500));
          }
        }
        const id =
          receipt(result, op) ??
          (result?.verified === true ? result?.receipt_id : undefined);
        row.status = id || verified ? "confirmed" : "unknown_outcome";
        if (id) row.receipt_id = id;
        if (op === "message_send") {
          const entity = normalize(result ?? {}).entities.find(
            (x: Args) => x.entityUrn === id,
          );
          row.conversation_urn =
            a.conversation_urn ??
            entity?.conversationUrn ??
            entity?.conversation?.entityUrn ??
            null;
        }
      } catch (e) {
        if (
          e instanceof Fault &&
          e.details.dispatch_state === "not_dispatched" &&
          [
            "invitation_respond",
            "invitation_withdraw",
            "conversation_delete",
          ].includes(op)
        )
          dispatched = false;
        row.status = dispatched ? "unknown_outcome" : "failed_before_dispatch";
        row.dispatch_state = dispatched
          ? e instanceof Fault && e.details.dispatch_state === "dispatched"
            ? "dispatched"
            : "unknown"
          : "not_dispatched";
        row.error = e instanceof Fault ? e.code : "transport_error";
      }
      try {
        await d.checkpoint?.();
        await d.store.set("journal", journal);
      } catch (e) {
        if (dispatched) throw new Fault("interrupted_unknown_outcome");
        throw e;
      }
      return row;
    }
    let state: Args = {};
    let cursorRecord: Args | undefined;
    if (a.cursor) {
      const saved = await d.store.get("cursor:" + a.cursor);
      if (!saved) throw new Fault("cursor_evicted");
      if (!saved || saved.scope !== scope || saved.expires < d.now())
        throw new Fault("invalid_cursor");
      await d.cursorContext?.(op, saved.state);
      if (saved.response) return saved.response;
      cursorRecord = saved;
      state = saved.state;
    }
    check();
    const api = capabilities[op].adapter === "api";
    const result = api
      ? await readApi(op, a, state, d.fetch)
      : await d.dom(op, a, state);
    if (self(await d.fetch({ path: "/me" })) !== expected)
      throw new Fault("account_changed");
    await d.checkpoint?.();
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
    if (Array.isArray(result.items) && "limit" in a) {
      result.next_cursor ??= null;
      result.partial = result.partial !== false || !!result.next_cursor;
      result.page_info = {
        returned_count: result.items.length,
        requested_limit: a.limit,
        continuation: result.next_cursor
          ? "available"
          : result.completeness === "source_exhausted"
            ? "exhausted"
            : "blocked",
        coverage:
          result.partial || result.next_cursor
            ? "partial"
            : result.partial === false &&
                result.completeness === "source_exhausted"
              ? "complete_for_scope"
              : "unknown",
        consistency: "live_traversal",
        source: capabilities[op].source,
        order: result.order ?? capabilities[op].order,
        observed_at: new Date(d.now()).toISOString(),
        reason: result.reason ?? result.completeness ?? null,
        cursor_expires_at: result.next_cursor
          ? new Date(d.now() + 1800000).toISOString()
          : null,
      };
    }
    // Cache a consumed cursor's page: retries must not advance the live DOM twice.
    if (cursorRecord)
      await d.store.set("cursor:" + a.cursor, {
        ...cursorRecord,
        response: result,
      });
    return result;
  }
}
