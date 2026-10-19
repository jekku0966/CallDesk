# CallDeck

I wanted proper Answer and Decline buttons for Discord on my Stream Deck. That somehow turned into this project.

CallDeck lets you answer, decline and hang up calls without Discord's overlay or keyboard shortcuts. It uses a Vencord userplugin and a Stream Deck companion. Answer shows the caller's profile picture, name and call status. Group calls show up to four participants with a `+N` badge for the rest. Decline animates when a single incoming call is ringing, and Hang Up lights up when you're connected.

It's currently `v0.1.4-alpha`. All three actions were tested on my Windows setup with official Discord and a custom Vencord build before the state-sync and caller-display updates. The updates pass automated tests and build checks, but still need real-call testing. Group calls and simultaneous incoming calls also need separate testing. The checks are listed in [VALIDATION.md](VALIDATION.md).

## What you need

- Windows 10 or newer.
- Stream Deck 6.6 or newer.
- Git, Node.js and Corepack to build and install it.
- A custom Vencord build with CallDeck included.

CallDeck isn't in Vencord's official plugin list. You need to build it from source. Browser Discord won't work because the local bridge needs Node.js.

## Install the Vencord plugin

Download or clone this repo, then open PowerShell in its folder.

Fully quit Discord first, including the tray process. Closing the window isn't enough.

Paste this block. It creates a separate Vencord checkout under your local application data and stops if something fails:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $plugin = Join-Path (Get-Location) 'vencord\callDeck'
    $checkout = Join-Path $env:LOCALAPPDATA 'CallDeck\Vencord'
    if (-not (Test-Path "$plugin\index.ts")) {
        throw 'Run this from the CallDeck repository folder.'
    }
    foreach ($command in @('git', 'node', 'corepack.cmd')) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "$command is missing. Install the prerequisites first."
        }
    }
    if (Test-Path $checkout) {
        throw 'That Vencord folder already exists. Use the update instructions below.'
    }
    New-Item -ItemType Directory -Path (Split-Path $checkout) -Force | Out-Null
    git clone --depth 1 --branch main https://github.com/Vendicated/Vencord.git $checkout
    if ($LASTEXITCODE -ne 0) { throw 'Clone failed.' }
    New-Item -ItemType Directory -Path "$checkout\src\userplugins" -Force | Out-Null
    Copy-Item $plugin "$checkout\src\userplugins\callDeck" -Recurse
    Push-Location $checkout
    try {
        corepack.cmd pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        corepack.cmd pnpm build --disable-updater
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
        corepack.cmd pnpm inject
        if ($LASTEXITCODE -ne 0) { throw 'Injection failed.' }
    } finally { Pop-Location }
}
```

Already have a custom Vencord checkout? Copy `vencord/callDeck` into `src/userplugins/callDeck`, then build and inject from there. [Vencord's custom plugin guide](https://docs.vencord.dev/installing/custom-plugins/) covers that setup.

Generate a password for the local bridge:

```powershell
powershell.exe -NoProfile -File .\vencord\scripts\New-CallDeckToken.ps1
```

Reopen Discord and go to **Settings → Vencord → Plugins → CallDeck**.

Set `accessToken` to the generated value. Leave `port` at `9473`, enable CallDeck and fully restart Discord.

**Use the generated bridge password. Never put your Discord account token here.**

## Install the Stream Deck plugin

From this repo's folder, build the installer:

```powershell
npx.cmd --yes @elgato/cli@1.10.1 pack .\streamdeck\com.nks.calldeck.sdPlugin
```

Double-click the resulting `com.nks.calldeck.streamDeckPlugin` file to install it. Stream Deck supplies Node for running the plugin.

Drag the CallDeck Answer, Decline and Hang Up actions onto your keys. Select any one of them, enter the same bridge token and port, then click **Save & test**.

Those settings apply to all CallDeck keys. The icons are included and change with the call state, so you don't need to assign them manually. There's more detail in the [Stream Deck README](streamdeck/README.md).

## Updating it

For incoming-call automatic switching, install the v0.1.4 Stream Deck companion and follow [the profile setup guide](streamdeck/INCOMING-PROFILES.md). This feature alone needs no Vencord rebuild if you already have the v0.1.2 bridge. It is optional and off by default. It opens a bundled call-control profile; Elgato cannot switch directly to page 2 of your own layout. Return timing and selected devices are configurable. Hardware import and exact page restoration still need live verification.

Discord changes its internals, which can break a custom Vencord build. The install command disables automatic Vencord updates so CallDeck stays included. You'll need to update and rebuild that checkout yourself.

Fully quit Discord, then run this. Change the path if you installed somewhere else:

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Push-Location (Join-Path $env:LOCALAPPDATA 'CallDeck\Vencord')
    try {
        git pull --ff-only
        if ($LASTEXITCODE -ne 0) { throw 'Update failed; do not discard local changes.' }
        corepack.cmd pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
        corepack.cmd pnpm build --disable-updater
        if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
        corepack.cmd pnpm inject
        if ($LASTEXITCODE -ne 0) { throw 'Injection failed.' }
    } finally { Pop-Location }
}
```

That updates Vencord. To update CallDeck's source too, copy the newer `vencord/callDeck` folder into your checkout before rebuilding.

Reopen Discord and check the buttons afterward.

## What the bridge does

It listens on `127.0.0.1` and uses a generated 256-bit password. The endpoints are `GET /status` and `POST /answer`, `/decline` and `/hangup`.

Discord store changes now trigger state snapshots immediately. The Stream Deck plugin waits for changes through authenticated HTTP long polling, using one shared connection for all CallDeck keys. With automatic switching enabled for a supported device, that observer continues while keys are hidden. A 200 ms renderer loop still delivers commands and reconciles state if a store notification is missed. Older bridges still work through the companion's 500 ms polling fallback.

Hang Up lights up only when Discord's RTC store reports a connected voice transport for the selected channel. Selecting a channel or dispatching Answer isn't enough. While Answer is pending, its rattle stops and the settings inspector reports that CallDeck is waiting for Discord. Hang Up can cancel a selected connection while it is still connecting, even though its icon stays dim.

After a communication failure, the companion clears its displayed call state and retries with a delay capped at five seconds. A restarted bridge uses a new session ID and supplies a fresh snapshot. Duplicate or older snapshots cannot overwrite a newer button check. The bridge keeps a dispatched action pending until Discord confirms its effect or a ten-second confirmation window expires. Timeout outcomes are uncertain; check Discord before retrying.

The port, token, action endpoints and artwork are unchanged. Update both the Vencord plugin and the Stream Deck companion to get RTC confirmation and long polling. See [STATESYNC.md](STATESYNC.md) for the architecture, protocol and remaining limitations.

Answer refuses multiple incoming calls and won't pull you out of another voice channel. Decline asks Discord to stop ringing for you. Hang Up disconnects the current voice channel, including a server voice channel.

A successful response means the command was dispatched. It doesn't confirm that the voice connection has finished connecting.

For a real incoming-call test, have a friend or a second Discord account call yours, then press Answer while it rings. CallDeck has no self-call endpoint. The PowerShell test script now shows the bridge's rejection reason; `409: No unambiguous target call` means it has no single ringing target to answer. Run the script with `-Action status` to inspect the current snapshot without changing a call.

CallDeck doesn't extract your Discord account token. The bridge password is stored in Vencord and Stream Deck settings without added encryption, so keep those settings out of public uploads.

## Caller display

The Answer key shows a DM portrait/name or a group grid while a call is incoming or active. It still answers when pressed; it never turns into Hang Up. The Answer symbol dims while pending or connected. When nothing is happening, all three controls return to their original static dim artwork.

Group portraits come from voice-state participants, with up to four shown and a `+N` badge for the rest. If those states are unavailable, a known caller or a group placeholder is shown instead. Names may be shortened to fit the key. Missing pictures fall back to initials.

Update both components and copy the entire Vencord plugin folder, including `display.ts`. The local status response now includes display names and public avatar URLs for authenticated clients. The companion caches public Discord CDN pictures in memory; it sends no bridge token or cookies to that CDN. Pictures are optional: call controls still work if they cannot load.

## Development

```sh
node --experimental-strip-types --test vencord/tests/bridge.test.ts
node --experimental-strip-types --test vencord/tests/renderer.test.ts
node --experimental-strip-types --test vencord/tests/display.test.ts vencord/tests/display-bridge.test.ts
node --test streamdeck/tests/*.test.cjs
npx @elgato/cli@1.10.1 validate streamdeck/com.nks.calldeck.sdPlugin
```

The bridge tests need Node 24 or newer. Vencord integration checks run inside a Vencord source checkout. The `ws` dependency is included with its MIT license.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). Included dependencies keep their own licenses.

Built with Codex assistance and live-tested on my own setup. The artwork was generated with OpenAI image generation.

CallDeck is an independent project. It isn't endorsed by Discord, Vencord or Elgato.
