# Work in LinkedIn without interrupting the browser

The 0.8.4 development build removes the tab activation that used to precede every DOM operation. With Chrome open, the agent keeps its own LinkedIn tab. In **Settings & help → Agent workspace**, choose:

- **Background tab** (default): create an inactive tab in an existing window.
- **Separate window**: choose **Open separate window** once to open the agent window. Subsequent operations use an inactive LinkedIn tab in that window. If the window is closed, the agent uses an inactive tab in an existing normal window until you choose to open the separate window again.

**Show workspace** deliberately brings the agent tab into view. Changing the setting does not bring anything forward. It takes effect for the next operation after previously queued work. Chrome may keep an old workspace open; closing it is safe. The agent does not close other tabs in a window. Login and first-install setup are human interactions. When Chrome is closed, the agent does not launch it.

Reloading a connected extension or reconnecting its native host does not request a work tab. On the next operation, the separate window can recover its inactive tab when the saved tab ID, the extension page in that window and the opener ID agree. If the user selects a work tab, the next operation leaves it alone and acquires an inactive one. An ID recovered from durable storage is not enough to take over someone's personal tab. Changing workspace invalidates document-bound cursors, but keeps account binding, API pagination, and send receipts. Dispatched writes are never replayed to recover from a slow, discarded or closed tab.

## Current macOS results

On build `80716c16`, the separate window preserved the selected tab and window during inbox, message, search, post and comment reads. After six minutes without MCP polling, inbox and post reads also completed with zero tab activations or window focus changes.

Build `aab7d075` was retested on two posts with known reactions. Each initial read and each follow-up read through the retained dialog reported `reaction_content_not_loaded` with reason `reaction_list_empty_while_hidden`. An earlier inspection of one visible dialog had shown ten profile links. The hidden-page result therefore cannot establish how many people reacted. This retest did not collect a new focus measurement. That dialog-based retest failed release acceptance.

The new page adapter from `7f8571e` read two pages each in a Dotun → Todd → Dotun sequence on macOS. All three traversals returned four distinct reactors, each repeated cursor returned identical items, and the second Dotun traversal matched the first. The two posts returned different people. A passive macOS observer recorded 393 samples over 85 seconds, with the work tab never selected in the front window and no observed tab, window or application switch. This observation was sampled. Chrome still reported background build `aab7d075` while injecting the new adapter, so the run is functional evidence and is not credited to whole-build Store acceptance.

On the fully reloaded build `c4c954fb`, the internal macOS measurement verified all twelve calls in a two-post reaction test. Each post change returned two distinct pages and an identical cursor replay. Chrome reported hidden documents, stable selection, zero tab activations and zero window focus events on every call.

The broader separate-window test failed focus acceptance. All 54 reads returned the expected data across three passes, including the pass after the test client paused for six minutes. Chrome measured foreground workspace or document focus during 25 calls. Across the 18 reaction reads, ten stayed hidden throughout. The comparison search could load page two while hidden and also observed a focus transition on page one. The reported events do not identify who initiated a switch. A separate diagnostic encountered a concurrent MCP client, so a shared last-operation measurement must match the requested operation before it can be used as evidence. The passing reaction test does not qualify the full workspace for release.

## Release acceptance

The workspace selector is available in both builds. The measurement controls are available in the development build. Neither placement is advertised as verified on a platform until checked there in a normal, signed-in Chrome without a debugger. Store publishing remains gated separately. The previous Store version is unaffected.

1. Build and install the matching development host and extension. In **Settings & help**, choose the mode; in **Advanced**, start focus measurement. Return to a different tab or application. Keep DevTools closed.
2. Run `node scripts/workspace-acceptance.mjs background_tab` or `node scripts/workspace-acceptance.mjs separate_window` on the corresponding platform. The script checks the runtime fingerprint, account, selected mode and active measurement before running DOM readers. Three passes exercise the inbox, messages, paginated search, a known post with comments and reactions, and its author's profile and posts. There is a six-minute interval without MCP polling before the third pass. An empty known-positive result, foreground activation, missing sample, or expired measurement fails the run.
3. Repeat for the other mode. Additionally observe cold creation and recovery after closing the workspace, switching the active application, minimized Chrome, and worker/browser restart. Record the situation, platform and build. If the user manually changes tabs during a measured call the run is inconclusive: the event identifies a switch, not who caused it.
4. Keep metadata reports local under `artifacts/workspace-0.8.4/`. The report includes operation names, timings and page visibility, not URLs, message contents, participant names, or post bodies. Measurement is opt-in for 30 minutes. Background execution may be throttled or suspended by Chrome. A failed or missing measurement does not establish that foregrounding is necessary.

The Store manifest's `workspace.<darwin|win32>.<background_tab|separate_window>.evidence_path` must refer to the corresponding measured report. Existing capability and installation evidence is still required. A headless browser smoke test is useful for regressions; it is not evidence of macOS or Windows desktop focus behavior.

The candidate reads reactions through an activity-scoped, paginated query. For a share or UGC permalink, it uses the activity and attributed post URNs that LinkedIn puts on the same post card. It verifies the actor and activity in every returned reaction ID. A source change during pagination requires a fresh traversal. For posts without an accessible mapping, the existing scoped dialog remains available.
