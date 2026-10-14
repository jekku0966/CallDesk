# Validation

## State synchronization changes — 14 October 2026

Local checks on Windows using Node 24.20.0, starting from CallDesk commit `194f0cd`:

- Native bridge: 13 tests passed, 0 failed.
- Renderer simulation: 4 tests passed, 0 failed.
- Stream Deck companion: 7 tests passed, 0 failed.
- Official Elgato CLI 1.10.1 validation and installer packaging: passed.
- Vencord TypeScript check and ESLint for the copied plugin: passed, no diagnostics.
- Vencord desktop and standalone builds with CallDeck included and updater disabled: passed.

Vencord checkout: `16ec4ea838899706019e7f472e45f055070abeb1` (package version 1.15.11), dependencies installed from its frozen lockfile with pnpm 11.9.0. The four copied plugin source files were byte-compared against this repository. Builds were created in the separate validation checkout; Discord injection/installation was not performed.

The suites were rerun after the PC restart. Localhost connections require execution outside this environment's network sandbox; the first sandboxed baseline attempt failed with `EACCES`, then the original 6 bridge and 4 companion tests passed with localhost access enabled.

Coverage includes DM/group-DM incoming filtering, simultaneous incoming calls, Answer dispatch versus RTC confirmation, connecting/failure/unknown states, Decline recipient selection, server-channel Hang Up, rapid Answer/Hang Up, duplicate snapshots and commands, out-of-order reads, old sessions, transient renderer IPC failures, heartbeat expiry, dispatch and confirmation deadlines, bridge/companion restarts, shared keys, unchanged idle artwork, long polling and hidden-key shutdown. The renderer simulation loads the actual renderer module with mocked stores/native helpers. The companion process test uses the actual native Bridge and simulated Stream Deck WebSocket clients.

The process test checks that idle `/status` requests do not continue every 500 ms while long polling is held. No CPU/memory benchmark or hardware latency measurement was performed.

These are automated simulations. The live observations below apply to the earlier implementation; this update has not been independently exercised with a real Discord call or physical Stream Deck. The packaged `v0.1.1-alpha` companion uses manifest version `0.1.1.0` and package version `0.1.1`.

The Windows PowerShell 5.1 diagnostic script was checked against a simulated HTTP 409 JSON response. It reports `CallDeck HTTP 409: No unambiguous target call` instead of hiding the bridge's rejection reason. A read-only snapshot from the running bridge also confirmed the new protocol fields; this does not validate real-call actions.

### Manual checks for this update

Update both components, retaining the existing token/port. Copy the whole Vencord plugin folder, including `state.ts`, rebuild/inject and fully restart Discord. Install the newly packed companion, accepting replacement of the existing alpha package if prompted.

- [ ] Incoming DM: both incoming buttons rattle; Answer stops rattling while pending; Hang Up becomes bright only once voice is connected.
- [ ] Failed connection / network loss: Hang Up stays dim during setup and becomes dim on lost RTC confirmation. Check inspector error/unknown feedback.
- [ ] Answer followed quickly by Hang Up during setup: cancel the selected target without a false connected icon.
- [ ] Repeated Answer/Decline presses, including duplicate keys: no repeated action while awaiting confirmation.
- [ ] Incoming group DM and simultaneous incoming calls: preserve recipient behavior and ambiguity refusal.
- [ ] Connected server voice plus incoming DM: Answer refuses switching, Decline still handles the incoming call, Hang Up disconnects server voice.
- [ ] Restart Discord/Vencord and Stream Deck separately, including rapid restarts: keys recover from a fresh snapshot without replaying actions.
- [ ] Disable/re-enable CallDeck, change token/port, wrong-token test, sleep/wake and hidden profiles: clear stale feedback and recover after correcting configuration.
- [ ] Slow or failed Discord action: inspect Discord before retrying a timeout; the action may finish later.
- [ ] Confirm the existing artwork/animation looks right on the physical keys. Record Discord, Vencord and Stream Deck versions with live results.

Architecture and protocol details are in [STATESYNC.md](STATESYNC.md).

## Live results reported by the author — 11 October 2026

- Windows Stream Deck companion installed and used with official Discord + custom Vencord.
- Incoming-call Answer works.
- Decline works.
- All three Stream Deck actions are reported working as intended.
- Hang Up works; earlier server voice-channel Hang Up also reported working.
- Updated Vencord build restores ServerInfo Friends and retains CallDeck functionality.

Exact Discord, Stream Deck and updated Vencord commit versions were not recorded. This repository packages the existing local CallDeck source; the source on the author's Windows PC was not byte-compared against it. Live results are reported observations, not independent testing by the packaging environment.

Not yet separately documented: caller-side effects of Decline, incoming group calls, simultaneous calls, sleep/wake, Vesktop on the updated source and hardware animation details.

## Automated packaging checks — 11 October 2026

Run using Node 24.19.0:

- Native bridge tests: 6 passed, 0 failed.
- Stream Deck companion tests: 4 passed, 0 failed.
- Official Elgato CLI 1.10.1 manifest validation: passed.
- CallDeck executable source is unchanged from the existing local source package.

No new Windows runtime tests or current Vencord TypeScript/build checks were performed in this packaging environment. Windows installation instructions were reviewed, not executed here.

## Earlier Vencord integration checks

The original implementation passed TypeScript, ESLint, desktop and standalone builds against Vencord commit `3374b8a9d8f6b051c64204917360293aad7f5d75` (1.15.10) on 6 October 2026. That is historical build evidence, not the current recommended Vencord checkout. See [the original record](vencord/VALIDATION.md).
