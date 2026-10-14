# Changelog

## v0.1.1-alpha — 14 October 2026

- Discord store changes trigger immediate state snapshots. The companion uses authenticated HTTP long polling; the renderer keeps its 200 ms command/reconciliation loop.
- Connected feedback requires RTC confirmation for the selected channel. Answer dispatch is shown as pending, and Hang Up can cancel a selected connection during setup.
- Pending-operation guards, snapshot revisions, session IDs and request ordering handle duplicate presses and stale responses.
- Communication failures clear displayed state and retry with bounded backoff. Restart recovery reads a fresh snapshot and never replays commands.
- The PowerShell action script reports the bridge's JSON error reason.
- Existing action endpoints, token/port settings and artwork are retained. Update both components, including the new `state.ts` file.

Validation: 24 automated bridge/renderer/companion tests, Vencord TypeScript and plugin lint checks, desktop/standalone builds, and Elgato manifest validation. Automated simulations do not establish live Discord compatibility. See [VALIDATION.md](VALIDATION.md) for the manual checklist and [STATESYNC.md](STATESYNC.md) for protocol details and limitations.
