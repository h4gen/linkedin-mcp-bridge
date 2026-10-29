# Validation record — 2026-10-29

Local development build 0.1.0.

- `npm run typecheck`: passed.
- `npm test`: 25 passing tests across core and actual built-runtime tests.
- `npm run package`: built `dist/linkedin-extension.zip`.
- Actual built service worker evaluated with a Chrome API test double; starts without Node imports.
- Actual MCP stdio process listed all 20 tools through the MCP SDK client.
- Installer executed in an isolated temporary HOME; exact extension origin and absolute Node/host launcher verified.
- Actual native-host process and Unix socket exchanged a framed request/response; socket mode 0600 verified.
- Account mismatch, recipient mismatch, concurrent same-key writes, queued cancellation, unknown mutation outcomes, journal persistence, cursor scope and read-state postcondition checks covered.

The source is integrated on local `main`. This newly created repository has no remote, so no fresh remote fetch or remote deployment can be reported. No separate worktree or feature branch was created. The existing Browser Bridge and LinkedIn extractor projects were read only and remain unchanged.

## Live state

Read-only LinkedIn UI lookup identified the authorized test contact:
https://www.linkedin.com/in/kirstin-taufertshoefer/

The search result showed an existing first-degree connection. No connection invitation is appropriate for that contact. No test message, public post, comment, reaction or conversation deletion was performed.

Chrome installation is awaiting action-time user confirmation required by the browser-control tool. No new extension permissions have been granted and no host was installed in the user's real Chrome profile. All installer tests used an isolated temporary home directory.

Live endpoint availability, unread preservation, history coverage, modern DOM selector compatibility, real delivery receipt parsing and store publication remain unverified. See `protocol.md` for operation-specific limitations. This record does not claim production readiness or completion of live acceptance.
