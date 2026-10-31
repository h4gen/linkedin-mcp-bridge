import { planningWrites, scheduleTime } from "./post-planning.js";
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
  reconcileDeletion,
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
  fetch: (
    request: Parameters<Fetcher>[0],
    check?: () => void,
  ) => ReturnType<Fetcher>;
  dom: (
    op: Operation,
    args: Args,
    state: Args,
    check?: () => void,
  ) => Promise<Args>;
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
        return this.d.fetch(request, check);
      },
      dom: async (op, args, state) => {
        check();
        return this.d.dom(op, args, state, check);
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
      let error: string | undefined = expected ? undefined : "disconnected";
      if (expected) {
        try {
          usable = self(await d.fetch({ path: "/me" })) === expected;
          if (!usable) error = "account_changed";
        } catch (e) {
          error = e instanceof Fault ? e.code : "browser_adapter_failed";
        }
      }
      return {
        version: VERSION,
        protocol: PROTOCOL,
        enabled_writes: [...writes],
        connected: usable,
        error,
        connection: {
          transport: "connected",
          session: usable ? "ready" : "unavailable",
          stage: !error
            ? "ready"
            : /tab_|browser_/.test(error)
              ? "tab"
              : "session",
        },
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
    // Early 0.5 development builds could label a post-dispatch refresh timeout
    // as pre-dispatch. Conservatively reconcile those schedules; never resend.
    for (const row of Object.values(journal) as Args[]) {
      if (
        row.operation === "post_schedule" &&
        row.version === "0.5.0" &&
        row.status === "failed_before_dispatch" &&
        row.error === "schedule_refresh_timeout"
      ) {
        row.status = "unknown_outcome";
        row.dispatch_state = "unknown";
      }
    }
    const key = await d.hash(`${expected}:${a.idempotency_key ?? ""}`);
    const scheduledTargets = (await d.store.get("scheduled-targets")) ?? {};
    for (const [ref, target] of Object.entries(scheduledTargets) as [
      string,
      Args,
    ][])
      if (Date.parse(target.scheduled_at) + 7 * 86400000 < d.now())
        delete scheduledTargets[ref];
    await d.store.set("scheduled-targets", scheduledTargets);
    const registerSchedule = async (item: Args) => {
      const ref = await d.hash(
        JSON.stringify([expected, item.text_hash, item.scheduled_at]),
      );
      scheduledTargets[ref] = {
        text_hash: item.text_hash,
        scheduled_at: item.scheduled_at,
        native_id: item.native_id ?? null,
        account_urn: expected,
      };
      await d.store.set("scheduled-targets", scheduledTargets);
      return ref;
    };
    const reconcilePlanning = async (row: Args) => {
      const result = await d.dom(
        row.operation,
        {
          account_urn: expected,
          reconcile: true,
          text_hash: row.text_hash,
          scheduled_at: row.scheduled_at,
          verified_target: row.planning_target,
          verified_actor: await d.identity?.(expected),
          execution_deadline: deadline,
        },
        {},
      );
      if (result.verified) {
        row.status = "confirmed";
        row.outcome = result.outcome;
        if (result.scheduled_item)
          row.scheduled_ref = await registerSchedule(result.scheduled_item);
        delete row.error;
        await d.store.set("journal", journal);
      }
      return row;
    };
    if (op === "operation_get") {
      const row = journal[key];
      if (!row) return { status: "not_found", retention_days: 7 };
      if (
        planningWrites.has(row.operation) &&
        ["pending", "unknown_outcome"].includes(row.status)
      ) {
        if (self(await d.fetch({ path: "/me" })) !== expected)
          throw new Fault("account_changed");
        try {
          await reconcilePlanning(row);
        } catch (e) {
          row.reconciliation =
            e instanceof Fault ? e.code : "reconciliation_unavailable";
        }
      }
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
      if (
        row.operation === "conversation_delete" &&
        ["pending", "unknown_outcome"].includes(row.status)
      ) {
        try {
          if (self(await d.fetch({ path: "/me" })) !== expected)
            throw new Fault("account_changed");
          if (await reconcileDeletion(row, d.fetch, check))
            row.status = "confirmed";
          await d.store.set("journal", journal);
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
        ((previous.error === "work_tab_navigation_timeout" &&
          previous.version === "0.4.1" &&
          previous.dispatch_state === "unknown") ||
          (!previous.dispatch_state &&
            ((op === "conversation_delete" &&
              previous.error === "conversation_pane_missing") ||
              (["invitation_respond", "invitation_withdraw"].includes(op) &&
                previous.error === "ui_control_ambiguous_or_missing"))));
      const continuationCandidate =
        previous?.status === "unknown_outcome" &&
        op === "invitation_withdraw" &&
        previous.version === "0.4.1" &&
        previous.dispatch_state === "dispatched" &&
        !previous.error;
      // The first 0.4.1 recovery adapter clicked the withdrawal link only.
      // Restrict migration to that recorded attempt, then require a fresh
      // exact invitation and link-control proof before opening its confirmation.
      const linkOnlyCandidate =
        continuationCandidate &&
        previous.attempt_count === 2 &&
        previous.previous_attempts?.length === 1 &&
        previous.previous_attempts[0].recovery ===
          "verified_legacy_pre_dispatch_failure_and_current_target";
      let resumeConfirmation = false;
      if (previous) {
        if (previous.fingerprint !== scope)
          throw new Fault("idempotency_conflict");
        if (
          planningWrites.has(op) &&
          ["pending", "unknown_outcome"].includes(previous.status)
        ) {
          try {
            await reconcilePlanning(previous);
          } catch (e) {
            previous.reconciliation =
              e instanceof Fault ? e.code : "reconciliation_unavailable";
          }
          return {
            ...previous,
            status:
              previous.status === "pending"
                ? "unknown_outcome"
                : previous.status,
            replayed: true,
          };
        }
        if (
          previous.status !== "failed_before_dispatch" &&
          !legacyCandidate &&
          !continuationCandidate
        )
          return {
            ...previous,
            status:
              previous.status === "pending"
                ? "unknown_outcome"
                : previous.status,
            replayed: true,
          };
      }
      if (op === "post_schedule")
        a.scheduled_at = scheduleTime(a.scheduled_at, d.now());
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
      if (legacyCandidate || continuationCandidate) {
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
        resumeConfirmation =
          continuationCandidate && proof.continuation_ready === true;
        if (
          !proof.preflight ||
          proof.dispatch_state !== "not_dispatched" ||
          !(legacyCandidate
            ? proof.legacy_no_dispatch_proof
            : resumeConfirmation ||
              (linkOnlyCandidate && proof.legacy_no_dispatch_proof))
        )
          return {
            ...previous,
            replayed: true,
            reconciliation: "legacy_dispatch_not_disproven",
          };
      }
      if (op === "scheduled_post_cancel") {
        target = scheduledTargets[a.scheduled_ref];
        if (!target || target.account_urn !== expected)
          throw new Fault("scheduled_reference_unknown");
      }
      const actor =
        (planningWrites.has(op) || op === "post_comment") && d.identity
          ? await d.identity(expected)
          : undefined;
      if (
        (planningWrites.has(op) || op === "post_comment") &&
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
                    : linkOnlyCandidate && !resumeConfirmation
                      ? "verified_legacy_link_only_withdrawal"
                      : resumeConfirmation
                        ? "verified_pending_withdraw_confirmation"
                        : "failed_before_dispatch",
                },
              ].slice(-10),
            }
          : {}),
        ...(planningWrites.has(op)
          ? {
              text_hash: a.text
                ? await d.hash(
                    a.text
                      .replace(/\r\n/g, "\n")
                      .replace(/\u00a0/g, " ")
                      .trim(),
                  )
                : undefined,
              scheduled_at: a.scheduled_at,
              planning_target:
                op === "scheduled_post_cancel" ? target : undefined,
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
          a.invitation_urn ??
          a.scheduled_ref,
      };
      journal[key] = row;
      await d.checkpoint?.();
      await d.store.set("journal", journal); // durable before dispatch
      let dispatched = false;
      let mutationReturned = false;
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
                resume_confirmation: resumeConfirmation,
              },
              {},
            );
        mutationReturned = true;
        row.dispatch_state = "dispatched";
        await d.store.set("journal", journal);
        if (op === "post_schedule" || op === "scheduled_post_cancel") {
          const fresh = await d.dom(
            "scheduled_posts_list",
            {
              account_urn: expected,
              verified_actor: actor,
              execution_deadline: deadline,
            },
            {},
          );
          if (fresh.complete !== true)
            throw new Fault("scheduled_list_incomplete");
          if (op === "post_schedule") {
            const hits = fresh.items.filter(
              (x: Args) =>
                x.text_hash === row.text_hash &&
                x.scheduled_at === row.scheduled_at,
            );
            result.verified = hits.length === 1;
            result.scheduled_item = hits.length === 1 ? hits[0] : undefined;
          } else {
            result.verified = !fresh.items.some((x: Args) =>
              target?.native_id
                ? x.native_id === target.native_id
                : x.text_hash === target?.text_hash &&
                  x.scheduled_at === target?.scheduled_at,
            );
          }
        }
        let verified = result?.verified === true;
        if (planningWrites.has(op)) {
          row.outcome = result.outcome;
          if (result.scheduled_item)
            row.scheduled_ref = await registerSchedule(result.scheduled_item);
          if (op === "scheduled_post_cancel")
            row.scheduled_ref = a.scheduled_ref;
        }
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
              verified = await reconcileDeletion(row, d.fetch, check);
              break;
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
          !mutationReturned &&
          e instanceof Fault &&
          e.details.dispatch_state === "not_dispatched" &&
          (planningWrites.has(op) ||
            [
              "invitation_respond",
              "invitation_withdraw",
              "conversation_delete",
            ].includes(op))
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
      : await d.dom(
          op,
          op === "scheduled_posts_list"
            ? {
                ...a,
                verified_actor: await d.identity?.(expected),
                execution_deadline: deadline,
              }
            : a,
          state,
        );
    if (op === "scheduled_posts_list") {
      result.items = await Promise.all(
        result.items.map(async (item: Args) => ({
          text: item.text,
          scheduled_at: item.scheduled_at,
          scheduled_ref: await registerSchedule(item),
        })),
      );
    }
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
