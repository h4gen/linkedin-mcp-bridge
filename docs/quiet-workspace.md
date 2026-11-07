# Work in LinkedIn without interrupting the browser

The 0.8.4 development build removes the tab activation that used to precede every DOM operation. With Chrome open, the agent keeps its own LinkedIn tab. In **Settings & help → Agent workspace**, choose:

- **Background tab** (initial development setting): create an inactive tab in an existing window.
- **Separate window**: create a normal Chrome window without asking Chrome to focus it. Its LinkedIn tab can be selected inside that window while the user continues in a different window or app.

**Show workspace** deliberately brings the agent tab into view. Changing the setting does not bring anything forward. It takes effect for the next operation after previously queued work. Chrome may keep an old workspace open; closing it is safe. The agent does not close other tabs in a window. Login and first-install setup are human interactions. When Chrome is closed, the agent does not launch it.

The lease belongs to a browser session. A worker restart reuses the owned tab; a browser restart creates a new one and checks the account. An ID recovered from durable storage is not enough to take over someone's personal tab. Changing workspace invalidates document-bound cursors, but keeps account binding, API pagination, and send receipts. Dispatched writes are never replayed to recover from a slow, discarded or closed tab.

## Release acceptance

The mode selector and measurement controls are initially available in the development build. Neither placement is advertised as verified on a platform until checked there in a normal, signed-in Chrome without a debugger. Store publishing remains gated separately. The previous Store version is unaffected.

1. Build and install the matching development host and extension. In **Settings & help**, choose the mode; in **Advanced**, start focus measurement. Return to a different tab or application. Keep DevTools closed.
2. Run `node scripts/workspace-acceptance.mjs background_tab` or `node scripts/workspace-acceptance.mjs separate_window` on the corresponding platform. The script checks the runtime fingerprint, account, selected mode and active measurement before running DOM readers. Three passes exercise the inbox, messages, paginated search, a known post with comments and reactions, and its author's profile and posts. There is a six-minute interval without MCP polling before the third pass. An empty known-positive result, foreground activation, missing sample, or expired measurement fails the run.
3. Repeat for the other mode. Additionally observe cold creation and recovery after closing the workspace, switching the active application, minimized Chrome, and worker/browser restart. Record the situation, platform and build. If the user manually changes tabs during a measured call the run is inconclusive: the event identifies a switch, not who caused it.
4. Keep metadata reports local under `artifacts/workspace-0.8.4/`. The report includes operation names, timings and page visibility, not URLs, message contents, participant names, or post bodies. Measurement is opt-in for 30 minutes. Background execution may be throttled or suspended by Chrome. A failed or missing measurement does not establish that foregrounding is necessary.

The Store manifest's `workspace.<darwin|win32>.<background_tab|separate_window>.evidence_path` must refer to the corresponding measured report. Existing capability and installation evidence is still required. A headless browser smoke test is useful for regressions; it is not evidence of macOS or Windows desktop focus behavior.
