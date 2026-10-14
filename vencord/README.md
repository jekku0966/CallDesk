# CallDeck v0.1.1-alpha

A Vencord userplugin that exposes **Answer / Decline / Hang Up** to Stream Deck through an authenticated local HTTP bridge. No overlay, hotkey emulation or window focus switching. Works by asking the running Discord renderer to perform call actions.

**Release status:** alpha source release. Native bridge automated tests and Vencord build validation are recorded in VALIDATION.md. The author reports successful live Answer, Decline and Hang Up tests on Windows with official Discord + a custom Vencord build (11 October 2026). Group calls and Vesktop compatibility still need separate live verification.

## Install on Windows

Custom plugins require a source build of Vencord; dropping this ZIP into the normal installer does not install it.

1. Follow [Vencord's source installation guide](https://docs.vencord.dev/installing/).
2. Copy the **callDeck** directory into `Vencord/src/userplugins/callDeck`. The directory must directly contain `index.ts`, `native.ts`, `bridge.ts` and `state.ts`.
3. Copy the whole folder, including `state.ts`, then from the Vencord checkout run:

   ```powershell
   pnpm install --frozen-lockfile
   pnpm build --disable-updater
   pnpm inject
   ```

4. Fully quit Discord, including its tray process, and reopen it.
5. Run the supplied token generator:

   ```powershell
   powershell.exe -NoProfile -File .\scripts\New-CallDeckToken.ps1
   ```

6. In **Settings → Vencord → Plugins → CallDeck**, paste that generated value into **accessToken**. Leave **port** at `9473` unless already occupied. Enable CallDeck and fully restart Discord. If you enabled it before setting the token, it deliberately refuses to start until re-enabled/restarted.
7. Keep the token private. It is a local bridge password, **never your Discord account token**. It is stored in Vencord settings, not encrypted; omit settings/tokens from bug reports.

### Vesktop

Build using `pnpm buildStandalone --disable-updater`. Set Vesktop's **Vencord location** to that checkout's `dist` directory, then fully restart Vesktop. Use the same plugin settings. Native support is required; browser Vencord is unsupported. See [custom plugin documentation](https://docs.vencord.dev/installing/custom-plugins/). Do not run two clients with CallDeck on the same port.

## Configure Stream Deck

Use an HTTP-request action that supports custom headers. Create these three buttons:

| Button | Method | URL | Header | Body |
| --- | --- | --- | --- | --- |
| Answer | POST | `http://127.0.0.1:9473/answer` | `Authorization: Bearer YOUR_GENERATED_TOKEN` | Empty |
| Decline | POST | `http://127.0.0.1:9473/decline` | Same | Empty |
| Hang Up | POST | `http://127.0.0.1:9473/hangup` | Same | Empty |

Use a request timeout of at least 8 seconds. Use the literal `127.0.0.1` address; `localhost` is intentionally rejected. GET requests never change calls. No Discord permissions prompt or OAuth application is required by this bridge.

Test directly first:

```powershell
.\scripts\Invoke-CallDeck.ps1 -Action status -Token YOUR_GENERATED_TOKEN
.\scripts\Invoke-CallDeck.ps1 -Action answer -Token YOUR_GENERATED_TOKEN
```

Static PNG and animated GIF button artwork is included in `icons/`; see `icons/README.md`. The companion in `../streamdeck` automatically switches icons by call state. The following HTTP-action instructions are an alternative to that companion. An HTTP action can poll `GET /status` with the same header if it supports response-based display rules. `state` retains `idle`, `ringing` or `connected`; `incoming` is an array of ringing DM/group-DM channel IDs. `connected` is now the RTC-confirmed voice channel ID or null; `selected` is the target channel, which may still be connecting. Names/messages are not exposed. `phase`, `operation`, `error`, `session` and `revision` provide synchronization detail. See [STATESYNC.md](../STATESYNC.md).

## Behavior

- Answer selects the one DM/group-DM currently ringing the logged-in user. It refuses ambiguous simultaneous calls and refuses to switch away from another connected voice channel.
- Decline posts to Discord's internal `stop-ringing` endpoint with **only your user ID** in `recipients`. This is intended to stop your ringing, not disconnect the caller or all group recipients. Verify actual UI behavior on your Discord build before relying on it.
- Hang Up disconnects the currently connected voice channel, including a server voice channel.
- Actions capture a specific target and recheck it in the renderer. They are never queued to execute after a reconnect.
- HTTP 200 means the Discord action was dispatched successfully, **not** that a voice connection has been confirmed. Inspect `/status` or the UI for the result.
- 401: wrong token. 403: browser request or wrong Host. 409: no call, ambiguous call, another action pending, call changed, or action failed. 503: disabled/unresponsive renderer. 504: timeout; check Discord before retrying.

## Live acceptance checklist

Have a friend call you; no outgoing call is placed automatically by this plugin.

- [x] Answer: incoming-call action reported working.
- [ ] Answer with Discord minimized and overlay off: conditions not separately recorded.
- [ ] Incoming group DM: answer and verify expected participants.
- [x] Decline: Stream Deck action reported working.
- [ ] Decline caller-side behavior: effects not separately recorded.
- [ ] Decline group DM: other recipients still ring.
- [x] Hang Up: current call disconnect and earlier server-voice disconnect reported working.
- [ ] Connected server voice plus incoming DM: answer returns 409, decline still works.
- [ ] Two simultaneous incoming calls: answer/decline return 409.
- [ ] Call ends before button press: no unintended connection.
- [ ] Disable/re-enable, client restart and sleep/wake; no stale actions.
- [ ] Repeat in both official Discord + Vencord and Vesktop.

## Development / release

Run `node --experimental-strip-types --test tests/bridge.test.ts` using Node 24+, then copy the plugin into a Vencord checkout and run `pnpm testTsc`, `pnpm build`, `pnpm buildStandalone --disable-updater`. Record exact checkout/client versions and live results. Discord stores and actions are internal and may change.

The plugin uses a small native-to-renderer command queue polled every 200 ms. Discord store change listeners also trigger immediate, serialized exchanges. The renderer retries transient exchange failures with bounded backoff; bridge startup failures also retry. A dispatched action remains guarded until its effect is observed or the ten-second confirmation window expires. Hang Up can cancel an Answer target during connection setup. Awaiting a Discord action is bounded by the command deadline; a timed-out action may still finish inside Discord, so its outcome remains uncertain.

The server listens only on IPv4 loopback, requires a random 256-bit token, rejects browser Origin/Fetch Metadata and unexpected Host headers, accepts no action request bodies, and limits pending actions and status observers. Long polling has the same authentication checks as ordinary status reads. This does not protect against other local software that can read your settings. No Discord token is extracted or stored by this plugin; Discord's existing authenticated RestAPI handles decline.

Public distribution: publish this repository as an **independent userplugin** first. Official Vencord inclusion is a separate review process, not guaranteed. Replace the placeholder author ID `0n` with your public Discord user ID before an upstream submission, follow their contributor rules, and complete live acceptance tests. This archive contains source, not prebuilt Vencord binaries.

Client modifications may conflict with Discord's terms; consult [Vencord's support page](https://vencord.dev/support/). This plugin is unofficial and is not endorsed by Discord, Elgato or Vencord.

## License

GPL-3.0-or-later; see LICENSE. Original CallDeck implementation; no code copied from the previously referenced third-party call-control plugin. Vencord integration references are listed in VALIDATION.md.
