# CallDeck

Answer, decline and hang up Discord calls from Stream Deck. No overlay or keyboard shortcuts.

CallDeck has two parts: a Vencord userplugin that controls the running Discord client, and a Stream Deck companion with call-state icons. Answer and Decline rattle while a single incoming call is ringing; Hang Up lights up when connected.

**Status: v0.1.0-alpha.** The author reports successful Windows installation and live Answer, Decline and Hang Up tests with official Discord + a custom Vencord build (11 October 2026). Group-call behavior and simultaneous calls still need separate live verification. See [VALIDATION.md](VALIDATION.md).

## Install the Vencord plugin

Requires Git, Node.js and Corepack. This is an independent userplugin, not part of the official Vencord plugin catalogue. Browser Discord is unsupported because the bridge needs Node.js.

Download or clone this repository first. Fully quit Discord, including its system-tray process. From this repository's folder, run the following in PowerShell. It makes a separate Vencord checkout under your local application data and stops on failure:

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

For an existing custom checkout, copy `vencord/callDeck` into its `src/userplugins/callDeck`, then build and inject from that checkout. See [Vencord's custom plugin guide](https://docs.vencord.dev/installing/custom-plugins/).

Generate a bridge password:

```powershell
powershell.exe -NoProfile -File .\vencord\scripts\New-CallDeckToken.ps1
```

Reopen Discord. In **Settings → Vencord → Plugins → CallDeck**, set `accessToken` to that generated value and keep `port` at `9473`. Enable CallDeck and fully restart Discord. This is a local bridge password, **never your Discord account token**.

## Install the Stream Deck companion

Build the installer from the included source:

```powershell
npx.cmd --yes @elgato/cli@1.10.1 pack .\streamdeck\com.nks.calldeck.sdPlugin
```

Double-click the resulting `com.nks.calldeck.streamDeckPlugin`. Requires Windows 10+ and Stream Deck 6.6+. Stream Deck supplies Node for running the installed companion.

Drag **CallDeck → Answer**, **Decline** and **Hang Up** onto keys. Select any CallDeck key, enter the same bridge token and port, then click **Save & test**. Settings are shared across CallDeck keys. Static and animated artwork is included; no manual icon assignment is needed. See the [companion documentation](streamdeck/README.md).

## Updates

Discord internals change, so a custom Vencord build occasionally needs rebuilding. Automatic Vencord updates are disabled by the build command above to keep CallDeck included. Fully quit Discord, then run this against your own checkout (replace the path if you used another location):

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

This updates Vencord, not CallDeck's source. To update CallDeck itself, copy the newer `vencord/callDeck` folder into your checkout before rebuilding. Reopen Discord and verify the call actions afterward.

## How it works

The bridge listens only on `127.0.0.1`, requires a generated 256-bit password, and exposes `GET /status` plus `POST /answer`, `/decline` and `/hangup`. The companion polls status and sends actions only on button presses. No Discord account token is extracted. Passwords are stored in Vencord and Stream Deck settings without added encryption; keep those settings out of public uploads.

Answer refuses ambiguous simultaneous calls and does not switch away from another connected voice channel. Decline requests that Discord stop ringing for the current user. Hang Up disconnects the current voice channel, including server voice. An accepted command means dispatched, not necessarily connected; check Discord for its result.

## Development

```sh
node --experimental-strip-types --test vencord/tests/bridge.test.ts
node --test streamdeck/tests/plugin.test.cjs
npx @elgato/cli@1.10.1 validate streamdeck/com.nks.calldeck.sdPlugin
```

Bridge tests require Node 24+. Vencord integration checks run inside a Vencord source checkout. The WebSocket dependency `ws` is vendored with its MIT license.

## License and provenance

GPL-3.0-or-later; see [LICENSE](LICENSE). Vendored dependencies retain their licenses. Code was developed with Codex assistance; all three Stream Deck actions were live-tested by the author. Artwork was generated with OpenAI image generation. CallDeck is independent and is not endorsed by Discord, Vencord or Elgato.
