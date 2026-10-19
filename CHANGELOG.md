# Changelog

## v0.1.3-alpha — 20 October 2026

- Optional incoming-call switching to bundled Standard/MK.2, Mini, XL, + and Neo profiles, with explicit device selection. It is off by default.
- One bridge observer continues while all keys are hidden when this feature is enabled; hidden keys generate no animation traffic.
- Only new single incoming calls trigger a switch. Repeated snapshots and restart baselines do not steal the deck repeatedly.
- Configurable return after call end, after ringing stops, or manually with Back; delay 0–10 seconds. Visible marked controls confirm ownership, and leaving them cancels automatic return.
- Setup preview handles profile installation before a real call. Package includes five credential-free profiles and a reproducible PowerShell generator.
- Existing Vencord source, bridge protocol, authentication and call commands are unchanged. Existing v0.1.2 custom Vencord installations need only the companion update.

Elgato permits bundled profiles, not arbitrary user-profile pages. Exact restoration and profile import require hardware checks; see [setup](streamdeck/INCOMING-PROFILES.md) and [validation](VALIDATION.md).

## v0.1.2-alpha — 14 October 2026

- The existing Answer key combines caller avatar/name, call status and the Answer control. It stays an Answer control while connecting/connected; Hang Up remains separate.
- Group calls show up to four actual voice participants with an additional-count badge. Missing identity/pictures use safe placeholders; idle restores the original dim artwork.
- Authenticated status snapshots add bounded caller metadata and the pending operation's target channel. Message contents and account credentials are not exposed.
- Public Discord CDN avatars use bounded downloads, an in-memory cache and failure backoff. No bridge authorization/cookies are sent, and redirects are rejected.
- Existing actions, authentication and Decline/Hang Up artwork remain intact. Copy the whole Vencord plugin folder, including `display.ts`, and update the companion.

This display has automated/rendering checks; live Discord identity and physical Stream Deck rendering still need verification. See [VALIDATION.md](VALIDATION.md).

## v0.1.1-alpha — 14 October 2026

- Discord store changes trigger immediate state snapshots. The companion uses authenticated HTTP long polling; the renderer keeps its 200 ms command/reconciliation loop.
- Connected feedback requires RTC confirmation for the selected channel. Answer dispatch is shown as pending, and Hang Up can cancel a selected connection during setup.
- Pending-operation guards, snapshot revisions, session IDs and request ordering handle duplicate presses and stale responses.
- Communication failures clear displayed state and retry with bounded backoff. Restart recovery reads a fresh snapshot and never replays commands.
- The PowerShell action script reports the bridge's JSON error reason.
- Existing action endpoints, token/port settings and artwork are retained. Update both components, including the new `state.ts` file.

Validation: 24 automated bridge/renderer/companion tests, Vencord TypeScript and plugin lint checks, desktop/standalone builds, and Elgato manifest validation. Automated simulations do not establish live Discord compatibility. See [VALIDATION.md](VALIDATION.md) for the manual checklist and [STATESYNC.md](STATESYNC.md) for protocol details and limitations.
