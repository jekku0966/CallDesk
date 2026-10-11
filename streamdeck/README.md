# CallDeck Stream Deck plugin — v0.1.0-alpha

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

Unavailable buttons show an alert when pressed and send no POST. Each accepted click checks fresh bridge status before dispatch. Repeated clicks while another command is pending are refused.

The plugin polls `GET /status` every 500 ms after each completed request, only while keys are visible. Requests never overlap. Rattles use PNG frames at 10 fps while ringing, with no animation traffic during idle. Connected Hang Up is static; it disconnects the current DM or server voice channel.

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

Four automated tests pass: configuration/eligibility, authenticated HTTP/error/timeout behavior, an actual spawned plugin process against simulated Stream Deck WebSocket and bridge HTTP servers, and property-inspector save/status behavior. Checks cover idle/ringing transitions, shared settings, duplicate clicks, unavailable actions, and polling shutdown when keys disappear.

Official Elgato CLI validation and packaging passed. Installer contents and animation PNG decoding were checked. On 11 October 2026 the author reported that installation and all three Stream Deck actions (Answer, Decline and Hang Up) work as intended. Hardware animation details and group-call edge cases were not separately documented. These are user-reported results; automated tests do not establish them.
