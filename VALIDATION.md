# Validation

## Incoming-call profiles — 20 October 2026

Base: CallDesk `302fbc9`. Windows automated checks; no real Discord calls or hardware profile switching performed for this update.

- Node 24.20.0: 44 bridge, renderer, caller-display, companion and profile tests passed, 0 failed. This includes a real companion process and native Bridge exchanging snapshots with zero visible keys, one held idle long poll, one switch per new ring, confirmed return, manual departure and disabled-feature shutdown.
- Stream Deck's bundled Node 20.20.2: 13 JavaScript feature/caller tests plus the spawned-companion process test passed. TypeScript bridge imports require Node 24 and were excluded from the successful Node 20 compatibility run. An earlier broad Node 20 attempt failed only on those unsupported imports; the full Node 24 suite passed.
- Nine profile tests passed again against the final generated archives. They inspect every registered ZIP for the four expected marked controls, bounded coordinates, matching device registration and absence of bridge credentials in action settings.
- Windows PowerShell 5.1 generator: passed after explicitly loading both ZIP assemblies. Two separate runs produce identical SHA-256 hashes for all five archives. Early generator checks caught assembly-loading and JSON-argument issues; both were corrected before packaging.
- Official Elgato CLI 1.10.1: final manifest/resource validation and packaging passed. The installer includes all five profiles, the profile controller, Back icon and updated inspector. Minimum Stream Deck remains 6.6, which introduced `Profiles[].AutoInstall`; page selection was introduced in 6.5.
- Vencord plugin source and bridge protocol are unchanged. Regression tests passed; upstream Vencord TypeScript/lint/desktop builds were not rerun because there are no Vencord changes.

The sandbox blocks localhost/network access and CLI cache writes. Successful network/process checks and CLI runs used the approved execution environment. No installed Discord/Vencord or Stream Deck configuration was changed, and no account or bridge token was read from it.

SDK constraints were checked against the current official [profiles guide](https://docs.elgato.com/streamdeck/sdk/guides/profiles/), [switch command](https://docs.elgato.com/streamdeck/sdk/references/websocket/plugin/#switchtoprofile), [manifest reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/) and [API changelog](https://docs.elgato.com/streamdeck/sdk/references/websocket/changelog/). The archive structure was inspected in Elgato's official Lights Out sample. Installed Elgato default archives supplied model IDs only; no user layout was copied.

The SDK documents returning to the previous profile by omitting the profile and retaining a previous page by omitting the page. Tests verify the exact command and cancellation rules, not the host's hardware behavior. There is no general profile-change event or switch acknowledgment; visibility markers are a conservative inference. No CPU/memory benchmark was performed.

### Live follow-up

- [ ] Install/update the companion, preview/import the correct device profile, and press Back. Confirm no installation prompt remains for the first real call.
- [ ] From your normal page 1 and page 3, test incoming DM → Decline, missed call, and Answer → Hang Up. Record the exact returned profile/page/folder.
- [ ] Navigate away manually during ringing, during a call and during the return delay; verify no forced return or repeated switch. Try manual re-entry too.
- [ ] Test all three return modes, delay limits, multiple devices, simultaneous incoming calls and an existing server voice connection.
- [ ] Test Discord/bridge and Stream Deck restart, wrong token, offline recovery, sleep/wake, unplug/replug and profile installation delayed beyond five seconds.
- [ ] Verify icons and layout on the physical device. Record Stream Deck/Discord/Vencord versions with results.

Update/install instructions are in [incoming-call profiles](streamdeck/INCOMING-PROFILES.md). The feature remains opt-in pending these hardware checks.

## Combined Answer/caller display — 14 October 2026

The `v0.1.2-alpha` update combines identity, status and Answer on the existing key. Checks used Node 24.20.0 and the same upstream Vencord checkout recorded below.

- Native bridge and identity tests: 18 passed, 0 failed.
- Renderer simulation: 4 passed, 0 failed.
- Companion rendering/cache/HTTP/process tests: 12 passed, 0 failed.
- Vencord TypeScript and plugin ESLint: passed with no diagnostics.
- Desktop and standalone builds with the five CallDeck source files: passed.
- Elgato CLI 1.10.1 validation and packaging for manifest `0.1.2.0`: passed.

Checks cover DM counterpart identity, actual group/server voice participants, four-portrait bounds, known-initiator fallback without an invented count, identity revision changes, metadata copying, escaped names, pending/connected Answer feedback, unchanged idle artwork, duplicate keys, avatar cache coalescing/backoff/bounds, redirect rejection and oversized/invalid avatar bodies. A real companion process receives simulated identity snapshots and retains the Answer action; pressing it while connected sends no Hang Up command.

Four public Discord default-avatar PNGs were fetched through the production avatar loader without credentials and rendered using the production SVG composer. The enlarged incoming/connecting/connected/group images were inspected. This checks the implemented image composition and public-CDN fetch path, not physical Stream Deck decoding or real caller identity. No real Discord calls were placed.

Manual follow-up: update both components, including `display.ts`, and check incoming DM identity, group participant joins/leaves and `+N`, missing-avatar fallback, rename/avatar changes, connected Answer remaining disabled, and idle/offline restoring the exact dim artwork. Check names at actual key size. Caller metadata uses internal Discord stores and still needs live verification. Avatar CDN access is optional and sends no bridge token or account cookies.

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
