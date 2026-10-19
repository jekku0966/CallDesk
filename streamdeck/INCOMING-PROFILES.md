# Incoming-call profiles — v0.1.3-alpha

CallDeck can show Answer, Decline, Hang Up and Back when a new Discord call rings, even when none of your CallDeck keys are visible. It is off by default. Select which Stream Decks should switch.

## Elgato's limits

The [official profile guide](https://docs.elgato.com/streamdeck/sdk/guides/profiles/) allows plugins to switch only to profiles bundled with that plugin. CallDeck cannot jump to page 2 of your own profile or read its profile name/page number. Instead it uses a separate CallDeck Incoming profile. This release supports Standard/MK.2, Mini, XL, + and Neo. Other device types, including Mobile and Pedal, are not enabled.

The [WebSocket API](https://docs.elgato.com/streamdeck/sdk/references/websocket/plugin/#switchtoprofile) documents returning to the previous profile by omitting `profile`. CallDeck sends an empty payload, omitting `page` too. Elgato documents omitted pages as using the previously visible page. This is the documented restoration mechanism; exact page/folder restoration still needs a check on your Stream Deck version.

There is no general current-profile query, profile-changed event or switch acknowledgment. CallDeck recognizes its bundled controls through an action-settings marker. Automatic return requires marked controls to appear after its switch request. Losing the last marked key cancels return, including when you navigate to another profile, page or folder. Manually re-entering does not restore return ownership. This is a conservative visibility check, not proof of every possible manual change. Keep the bundled controls together; copying marked keys into another layout can defeat the inference. Choose manual return if that limitation matters to your workflow.

## Update your existing custom Vencord setup

This feature changes only the Stream Deck companion. If you already run v0.1.2 CallDeck in your custom Vencord build, no Vencord rebuild, injection or Discord restart is needed. Keep your existing bridge token and port.

1. Double-click the supplied `com.nks.calldeck.streamDeckPlugin` and accept its update/replacement prompt. Keep your existing CallDeck keys. If the new settings do not appear, fully quit Stream Deck from its tray icon and reopen it.
2. Select any existing CallDeck key. Check the saved token and port, normally `9473`. If blank, enter the same values as **Discord → Settings → Vencord → Plugins → CallDeck**. Use your generated bridge password, never your Discord account token.
3. Leave automatic switching unchecked during setup. Select your deck under **Stream Decks to switch**, choose **After decline, missed call or call end**, keep the one-second delay, and click **Save & test**.
4. Click **Open selected call profile**. Accept profile installation if prompted. Confirm Answer, Decline, Hang Up and Back appear. Press **Back** on the deck to return. Repeat on each selected device.
5. Select a CallDeck key again, enable **Show CallDeck automatically for new incoming calls**, and **Save & test**.
6. Navigate to page 1 or 3. Have another account call you. The call profile should appear once. Decline or let it time out and check the return. Repeat with Answer followed by Hang Up.

If your Vencord CallDeck source predates the state-sync/caller-display updates, follow the [existing update instructions](../README.md#updating-it). Copy the entire `vencord/callDeck` folder into your existing checkout's `src/userplugins/callDeck`, fully quit Discord, build with `corepack.cmd pnpm build --disable-updater`, run `corepack.cmd pnpm inject`, then reopen Discord. Keep the existing custom checkout and other userplugins. Updating Vencord itself is separate from this feature.

## Return behavior

| Option | Behavior |
| --- | --- |
| After decline, missed call or call end (default) | Wait for no ringing, no pending action and cleared voice selection/connection at idle. Connecting, error, unknown and bridge offline do not count as call end. |
| When ringing stops | Return after ringing and pending actions clear, including after Answer. Place Hang Up on your normal layout if you need it there. |
| Manually with Back | Stay until you press the bundled Back key or navigate yourself. |

Delay is configurable from 0 to 10 seconds, default 1 second. Fresh ringing or a bridge failure cancels a pending timer; a fresh confirmed end state can schedule it again. If you were already in another voice channel, the default waits for that selection to clear too. Use after-ringing or Back for an earlier return.

Only a newly observed single incoming channel triggers switching. Duplicate snapshots, outgoing/connected calls and multiple simultaneous incoming calls do not. First snapshots after enabling/restarting or a new bridge session establish a baseline; calls already ringing then do not trigger a switch. Temporary failures retain the previous incoming IDs to avoid switching repeatedly for the same call. A missed end-and-new-ring transition during an outage cannot be inferred.

An unconfirmed switch expires after five seconds. A late installation can still open the profile, but it earns no automatic return; press Back. Settings changes, device disconnect and plugin restart discard return ownership. Disabling automatic switching while on the call profile leaves Back available.

## Monitoring and packaging

With switching enabled and a selected supported device known to Stream Deck, one authenticated observer runs even with zero visible keys. The updated bridge holds it for up to 20 seconds; older bridges use the existing 500 ms fallback. Failures back off to five seconds. With switching disabled, hiding every key stops monitoring as before. Hidden keys produce no animation or avatar traffic. Call commands remain explicit button presses.

Five profiles are registered with `AutoInstall: false` and `DontAutoSwitchWhenInstalled: true`. Setup opens the selected profile explicitly. The ZIPs contain only device/layout metadata and four marked controls, with no credentials or user layout data. The generator follows the V2 archive structure in [Elgato's official Lights Out sample](https://github.com/elgatosf/streamdeck-plugin-samples/tree/main/lights-out); it copies no user profiles or Elgato artwork.

From the repository root in PowerShell:

```powershell
powershell.exe -NoProfile -File .\streamdeck\scripts\Build-Profiles.ps1
node --test streamdeck/tests/*.test.cjs vencord/tests/*.test.ts
npx.cmd --yes @elgato/cli@1.10.1 validate .\streamdeck\com.nks.calldeck.sdPlugin
npx.cmd --yes @elgato/cli@1.10.1 pack .\streamdeck\com.nks.calldeck.sdPlugin
```

Use Node 24+ for the TypeScript tests. Stream Deck still supplies Node 20 for the companion. Generated profile archives are checked in. CLI validation checks the manifest/resources, not physical profile import or restoration. See [VALIDATION.md](../VALIDATION.md) for measured results and the hardware checklist.
