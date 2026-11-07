// Opt-in, development-only measurements. Never inspect any other tab's content.
// Counters include manual switches: a nonzero count is not proof of attribution.
export function workspaceProbe() {
  let until = 0;
  let sequence = 0;
  let last: Record<string, unknown> | undefined;
  const rows: Record<string, unknown>[] = [];
  const enabled = () => Date.now() < until;
  function record(data: Record<string, unknown>) {
    if (!enabled()) return;
    rows.push({ sequence: ++sequence, at: Date.now(), ...data });
    if (rows.length > 192) rows.shift();
  }
  chrome.tabs?.onActivated?.addListener(({ tabId, windowId }) =>
    record({ event: "tab_activated", tabId, windowId }),
  );
  chrome.windows?.onFocusChanged?.addListener((windowId) =>
    record({ event: "window_focus", windowId }),
  );
  async function sample(phase: string, op: string, id: number) {
    if (!enabled()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const snapshot = async () => {
        const [tab, front, page] = await Promise.all([
          chrome.tabs.get(id),
          chrome.windows.getLastFocused(),
          chrome.scripting.executeScript({
            target: { tabId: id },
            world: "ISOLATED",
            func: () => ({
              visibility: document.visibilityState,
              documentFocused: document.hasFocus(),
              ready: document.readyState,
            }),
          }),
        ]);
        const [selected] = await chrome.tabs.query({
          active: true,
          windowId: front.id,
        });
        return {
          phase,
          op,
          tabId: id,
          windowId: tab.windowId,
          tabActive: tab.active,
          selectedTabId: selected?.id,
          focusedWindowId: front.focused ? front.id : null,
          documentId: page[0]?.documentId,
          ...page[0]?.result,
        };
      };
      record(
        await Promise.race([
          snapshot(),
          new Promise<Record<string, unknown>>((resolve) => {
            timer = setTimeout(
              () => resolve({ phase, op, unavailable: true }),
              750,
            );
          }),
        ]),
      );
    } catch {
      record({ phase, op, unavailable: true });
    } finally {
      clearTimeout(timer);
    }
  }
  function begin(op: string) {
    if (!enabled() || op === "health") return;
    record({ phase: "begin", op });
    return { seq: sequence, at: Date.now() };
  }
  async function finish(
    op: string,
    mark: ReturnType<typeof begin>,
    id: number | undefined,
    ok: boolean,
  ) {
    if (!mark || !enabled()) return;
    if (id !== undefined) await sample("exit", op, id);
    const run = rows.filter((r) => Number(r.sequence) >= mark.seq);
    const snapshots = run.filter(
      (r) => r.tabId === id && typeof r.visibility === "string",
    );
    last = {
      op,
      ok,
      elapsed_ms: Date.now() - mark.at,
      sequence,
      complete:
        run[0]?.sequence === mark.seq &&
        run.filter((r) => r.phase === "begin").length === 1 &&
        run.at(-1)?.phase === "exit" &&
        snapshots.length > 1 &&
        !run.some((r) => r.unavailable),
      activations: run.filter((r) => r.event === "tab_activated").length,
      window_focus_events: run.filter((r) => r.event === "window_focus").length,
      work_foreground: snapshots.some(
        (r) => r.tabActive && r.windowId === r.focusedWindowId,
      ),
      selection_stable:
        snapshots.length > 1 &&
        snapshots.every(
          (r) =>
            r.selectedTabId !== undefined &&
            r.selectedTabId === snapshots[0].selectedTabId &&
            r.focusedWindowId === snapshots[0].focusedWindowId,
        ),
      visibility: [...new Set(snapshots.map((r) => r.visibility))],
      document_focused: snapshots.some((r) => r.documentFocused),
    };
  }
  return {
    sample,
    record,
    begin,
    finish,
    last: () => last,
    enabled,
    start: () => {
      rows.length = 0;
      last = undefined;
      until = Date.now() + 30 * 60000;
    },
    stop: () => {
      until = 0;
    },
    report: () => ({ active: enabled(), until, rows: [...rows] }),
  };
}
