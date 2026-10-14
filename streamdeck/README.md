# CallDeck Stream Deck plugin — v0.1.1-alpha

Three native Stream Deck actions: **Answer**, **Decline**, **Hang Up**. Enter the local bridge token once; the connection is shared across every CallDeck action.

## Install and use

1. Keep your working CallDeck Vencord plugin enabled in Discord + Vencord or Vesktop. This Stream Deck plugin is its companion, not a replacement.
2. Double-click `com.nks.calldeck.streamDeckPlugin`. Stream Deck should prompt to install it. Requires Windows 10+ and Stream Deck 6.6+; no separate Node.js installation is needed on your PC.
3. Drag **CallDeck → Answer**, **Decline**, and **Hang Up** onto three keys.
4. Select any CallDeck key. Paste the same **bridge token** you already entered in Vencord CallDeck. Leave port at **9473** and click **Save & test**. These settings apply to all three keys.
5. The inspector should report `Bridge connected — idle.` Have someone call you to test.
6. Remove the old API Ninja buttons when satisfied. No headers, URL entry or manual icon assignment is needed for the new actions.

If the action category does not appear, fully quit and restart the Stream Deck app. Do not manually replace the plugin's icons if you want automatic state artwork.

## Button behavior

| State | Answer | Decline | Hang Up |
| --- | --- | --- | --- |
| No call / bridge offline | Static dim | Static dim | Static dim |
| Exactly one incoming call, disconnected | Animated rattle | Animated rattle | Static dim |
| Connected voice channel | Static dim | Animated only if one incoming call | Static bright |
| Multiple incoming calls | Static dim | Static dim | Bright if connected |

Unavailable buttons show an alert when pressed and send no POST. Each click checks fresh bridge status before dispatch. Repeated clicks while another command is pending are refused. Answer stops rattling while its effect is pending. Hang Up stays dim during connection setup but can cancel the selected connection when pressed. Its bright icon requires RTC connection confirmation with the updated bridge.

The plugin shares one long-poll `GET /status` across all visible keys. The bridge responds when the state changes or after 20 seconds; the companion immediately waits again. Older bridges fall back to a status request every 500 ms after completion. Only one background status request runs at a time; a click can also request a fresh snapshot. Request ordering and bridge revisions prevent an older response from overwriting that check. Hiding every key cancels the background request.

Communication failures clear the displayed state. Reconnect retries start at 500 ms and increase to a five-second cap. Changed settings cancel the old observer. Restarted bridges use a fresh session and snapshot. Rattles still use the original PNG frames at 10 fps, with no animation traffic during idle. Connected Hang Up is static; it disconnects the current DM or server voice channel.

A green check means the bridge accepted/dispatched the command, not that a voice connection has been established. Confirm voice state in Discord. An action timeout can have an uncertain outcome; check Discord before pressing again.

## Troubleshooting

- **Wrong bridge token:** paste the Vencord plugin's `accessToken`, not your Discord token.
- **Bridge offline:** start your Discord client, enable CallDeck, check the port and fully restart the Discord client if its settings changed.
- **No suitable call:** there may be no ringing call, multiple incoming calls, or you may already be connected elsewhere.
- **Call changed / pending:** check the actual Discord call state before retrying.
- Do not use `localhost`, a remote host, or API Ninja polling for these actions. This plugin always connects to `127.0.0.1`.

The bridge token is stored in Stream Deck global settings without added encryption. Keep it out of public screenshots and backups you share. No Discord account credentials are needed or included.

## Build / tests

The complete source lives in `com.nks.calldeck.sdPlugin`. The WebSocket dependency (`ws` 8.21.0, MIT) is vendored with its license. No compilation is required.

```sh
node --test tests/plugin.test.cjs
npx @elgato/cli@1.10.1 validate com.nks.calldeck.sdPlugin
npx @elgato/cli@1.10.1 pack com.nks.calldeck.sdPlugin
```

The installer was created with the official Elgato CLI. Manifest SDK version 2; Node 20 is supplied by Stream Deck. This is an independent alpha, not an Elgato Marketplace release. Generated artwork and the CallDeck source are GPL-3.0-or-later; vendored third-party code retains its MIT license. Implementation was generated with Codex assistance. The author reports successful installation and live Answer, Decline and Hang Up tests; group-call and other edge cases need separate live verification.

## Validation

The companion tests cover configuration/eligibility, authenticated HTTP/error/timeout behavior, spawned plugin processes with simulated Stream Deck and bridge servers, property-inspector settings, stale snapshot rejection, long polling with the real native bridge, pending versus confirmed connections, bridge and companion restarts, shared keys, and shutdown when keys disappear. See [the current validation record](../VALIDATION.md) for results.

Official Elgato CLI validation and packaging passed. Installer contents and animation PNG decoding were checked. On 11 October 2026 the author reported that installation and all three Stream Deck actions (Answer, Decline and Hang Up) work as intended. Hardware animation details and group-call edge cases were not separately documented. These are user-reported results; automated tests do not establish them.
