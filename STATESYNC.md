# State synchronization

## Original behavior

The renderer exchanged a snapshot and received queued commands every 200 ms. The companion read `/status` every 500 ms after the previous request finished. All keys already shared settings and state. The bridge already authenticated requests, rejected browser clients, serialized actions, expired queued commands, and captured channel targets for renderer rechecks. Successful HTTP responses already meant dispatch, not connection confirmation.

The main gaps were that selected voice channels were reported as connected, command serialization ended at dispatch acknowledgment, and an overlapping background read could overwrite a newer button check. Renderer exchange failures also stopped the plugin until it was manually re-enabled.

## Choice

| Approach | Assessment for this code |
| --- | --- |
| Existing polling with correctness fixes | Smallest transport change, but companion updates still wait for its next request. |
| WebSocket | Bidirectional events and commands are possible, but require another authenticated protocol, socket lifecycle and migration of the working HTTP command path. |
| SSE | Fits one-way status updates, but requires streaming framing, parsing, heartbeat and reconnect handling in the Node companion. |
| Discord store listeners plus HTTP long polling | Uses the existing HTTP server and client. Returns complete snapshots on change, with a bounded wait and ordinary request error handling. Keeps existing action endpoints. |

The implementation uses store listeners plus long polling. The renderer's 200 ms loop remains for command delivery, heartbeat and reconciliation. This is intentionally a hybrid: native-to-renderer push would require a separate IPC mechanism. No new external dependencies or cloud services were added.

The process simulation verifies that idle status requests stop repeating at 500 ms while an observer is held. CPU, memory and end-to-end hardware latency were not benchmarked; no performance percentage is claimed.

## State sources and confirmation

`CallStore`, `ChannelStore` and `UserStore` identify DM/group-DM calls ringing the current user. Unavailable calls and server-channel ringing entries are excluded. Multiple ringing targets remain ambiguous, so Answer and Decline are refused.

`SelectedChannelStore` identifies the selected voice target. `RTCConnectionStore.getState()` and `getChannelId()` establish voice transport status. `connected` is populated only for `RTC_CONNECTED` when the RTC channel matches the selected channel. Known setup states map to `connecting`, `NO_ROUTE` to `error`, and unfamiliar or inconsistent states to `unknown`. A logged-out renderer reports unknown, not a confirmed idle connection.

These methods are Discord internals. Their signatures were checked in upstream Vencord commit `16ec4ea838899706019e7f472e45f055070abeb1`, including [RTCConnectionStore](https://github.com/Vendicated/Vencord/blob/16ec4ea838899706019e7f472e45f055070abeb1/packages/discord-types/src/stores/RTCConnectionStore.d.ts) and [FluxStore change listeners](https://github.com/Vendicated/Vencord/blob/16ec4ea838899706019e7f472e45f055070abeb1/packages/discord-types/src/stores/FluxStore.d.ts). Build success and mocks do not establish the methods' behavior in a particular live Discord release.

The bridge's `operation` records Answer, Decline or Hang Up separately from voice state. Answer sets `phase: answer-requested`; Hang Up sets `phase: disconnecting`. Answer settles on RTC confirmation or an observed connection error, Decline when its target stops ringing, and Hang Up when selection and confirmed connection are both absent. No synthetic historical `disconnected` event is created; the current snapshot describes what the stores expose.

Acceptance means the native bridge captured a command. HTTP 200 means renderer dispatch succeeded. Neither confirms the resulting Discord state. Commands are never automatically retried. Dispatch and confirmation timeouts report uncertainty. A duplicate or incompatible action is refused while an operation is pending; Hang Up remains permitted for a selected Answer target after dispatch acknowledgment.

## Protocol and recovery

Ordinary authenticated `GET /status` remains an immediate snapshot. Existing `POST /answer`, `/decline` and `/hangup` remain empty-body requests. The token, literal `127.0.0.1`, Host checks and browser rejection are unchanged.

Snapshots add `selected`, `voice`, `phase`, `operation`, `error`, `session`, `revision` and `longPoll`. The three legacy `state` values remain. Their meaning is intentionally conservative: `idle` can accompany `phase: connecting`, `error` or `unknown`, so consumers needing detail should use `phase`/`voice`. `connected` now means RTC confirmation rather than mere selection. Update any custom HTTP display rules that depended on the old meaning.

With `longPoll: true`, the companion requests `/status?session=<session>&revision=<revision>`. A matching session/revision holds the response for up to 20 seconds. A change releases all observers with a full snapshot. A mismatch immediately supplies the current snapshot. Incoming IDs are deduplicated and sorted; unchanged effective snapshots do not increment revisions. Each bridge start creates a new session. At most eight status observers are held, within the server's existing 16-connection limit.

Renderer heartbeat expiry at three seconds releases observers with HTTP 503; a 500 ms watchdog checks held requests. The companion clears stale artwork on communication failure and reconnects with delays from 500 ms to a five-second cap. Recovery reads current state. It never replays a command. Older bridges lack long-poll metadata and use the existing 500 ms fallback.

One background observer serves all visible keys. Button presses request fresh immediate snapshots independently. The companion rejects older same-session revisions and responses from requests issued before an already-applied read. A settings/visibility generation also prevents old-configuration responses from changing state. Settings changes, completed commands and hiding all keys abort obsolete background observers. Unchanged artwork and inspector messages are not resent.

Renderer exchanges are serialized. Store changes during an exchange trigger another exchange afterward. Transient IPC errors back off to a five-second cap, and startup failures retry. Plugin shutdown removes listeners and invalidates old lifecycle work.

## Limits and installation

### Combined caller display (v0.1.2-alpha)

The optional `display` snapshot field contains a channel ID, DM/group/server kind, bounded title, up to four participant records (ID, display name, public PNG avatar URL) and the known voice-participant total. Caller metadata is copied and validated in the bridge; identity changes increment the snapshot revision. `operationChannelId` prevents a pending action on one call from being labeled as an action on a different newly ringing caller.

DM identity comes from the channel's recipient. Group/server portraits come from `VoiceStateStore.getVoiceStatesForChannel`, with a matching call-message author's ID used to prioritize a known initiator or provide an incoming fallback. Only the message author's ID is read; message text is never returned. The fallback does not invent a voice-participant count. If identity stores fail, ordinary controls and heartbeat continue with no caller display.

The companion composes SVG images with embedded PNG avatars, escaped/shortened names, status and the Answer symbol. Elgato documents SVG data URLs in [the key image API](https://docs.elgato.com/streamdeck/sdk/guides/keys/). Avatars use an allowlist of Discord CDN hosts and public avatar paths, 128 KiB/256-pixel bounds, no redirected requests, a 2.5-second timeout, up to 32 cached entries, five-minute success caching and 30-second failure backoff. Missing avatars use initials. Authentication headers/cookies are never forwarded to CDN requests. All call commands remain on `127.0.0.1`.

This intentionally adds names and public avatar URLs to the authenticated bridge response; earlier versions exposed only call-state identifiers. It adds no account tokens, external call-control service or disk cache. Avatar CDN access is optional and independent from command availability. Copy all five Vencord plugin files, including `display.ts`, when updating.

Update both components for the new behavior. Copy the entire `vencord/callDeck` folder, rebuild Vencord, and install the newly packed Stream Deck companion. Existing token and port settings work. Artwork and animations are unchanged. The legacy companion can still read updated status; an updated companion can still use an older bridge, but that older bridge cannot provide RTC confirmation or the new pending-action guard.

The confirmation window is ten seconds from acceptance. It limits duplicate requests while an outcome is pending; it cannot guarantee exactly-once Discord execution after a timeout or restart. Underlying Discord actions cannot be canceled by an IPC deadline and may finish later. Check Discord before retrying an uncertain action. Internal store changes, live group-call semantics, sleep/wake and hardware rendering still need manual tests. Existing server voice-channel Hang Up is retained.
