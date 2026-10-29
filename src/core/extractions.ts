import { Args, Fault } from "./contracts.js";
import type { Store } from "./engine.js";
export class Extractions {
  constructor(
    private store: Store,
    private read: (op: string, a: Args) => Promise<Args>,
    private account: () => Promise<string | undefined>,
    private uuid = () => crypto.randomUUID(),
  ) {}
  async handle(op: string, a: Args): Promise<Args> {
    if ((await this.account()) !== a.account_urn)
      throw new Fault("account_mismatch");
    if (op === "extraction_start") {
      const id = this.uuid();
      const row = {
        id,
        account: a.account_urn,
        kind: a.kind,
        post_urn: a.post_urn,
        status: "running",
        items: [],
        expires: Date.now() + 1800000,
      };
      await this.store.set("extraction:" + id, row);
      void this.collect(id, a);
      return { operation_id: id, status: "running" };
    }
    const row = await this.store.get("extraction:" + a.operation_id);
    if (!row || row.expires < Date.now())
      throw new Fault("extraction_expired_or_missing");
    if (row.account !== a.account_urn) throw new Fault("account_mismatch");
    if (op === "extraction_cancel" && row.status === "running") {
      row.status = "cancelled";
      await this.store.set("extraction:" + row.id, row);
    }
    return {
      operation_id: row.id,
      status: row.status,
      count: row.items.length,
      partial: row.partial ?? true,
      error: row.error,
      items: row.items.slice(a.offset ?? 0, (a.offset ?? 0) + (a.limit ?? 20)),
      next_offset:
        (a.offset ?? 0) + (a.limit ?? 20) < row.items.length
          ? (a.offset ?? 0) + (a.limit ?? 20)
          : undefined,
    };
  }
  private async collect(id: string, a: Args) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    try {
      for (let page = 0; page < 25; page++) {
        let row = await this.store.get("extraction:" + id);
        if (!row || row.status !== "running") return;
        const result = await this.read(
          a.kind === "comments" ? "comments_list" : "reactions_list",
          {
            account_urn: a.account_urn,
            post_urn: a.post_urn,
            limit: 20,
            ...(cursor ? { cursor } : {}),
          },
        );
        row = await this.store.get("extraction:" + id);
        if (!row || row.status !== "running") return;
        for (const item of result.items) {
          const key = item.id ?? item.entityUrn ?? item.profile_url;
          if (key && !seen.has(key) && row.items.length < a.max_items) {
            seen.add(key);
            row.items.push(item);
          }
        }
        cursor = result.next_cursor;
        row.partial = result.partial;
        if (!cursor || row.items.length >= a.max_items || page === 24) {
          row.status = !cursor && !result.partial ? "completed" : "partial";
          row.partial = row.status !== "completed";
        }
        await this.store.set("extraction:" + id, row);
        if (row.status !== "running") return;
      }
    } catch (e) {
      const row = await this.store.get("extraction:" + id);
      if (row?.status === "running")
        await this.store.set("extraction:" + id, {
          ...row,
          status: "error",
          error: e instanceof Fault ? e.code : "extraction_failed",
        });
    }
  }
}
