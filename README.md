# CallDeck

I wanted proper Answer and Decline buttons for Discord on my Stream Deck. That somehow turned into this project.

CallDeck lets you answer, decline and hang up calls without Discord's overlay or keyboard shortcuts. It uses a Vencord userplugin and a Stream Deck companion. Answer and Decline animate when a single incoming call is ringing, and Hang Up lights up when you're connected.

It's currently `v0.1.0-alpha`. I've tested all three actions on my Windows setup with official Discord and a custom Vencord build. They work. Group calls and simultaneous incoming calls still need separate testing. The checks are listed in [VALIDATION.md](VALIDATION.md).

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

The Stream Deck plugin polls for call status. It sends call actions when you press a button.

Answer refuses multiple incoming calls and won't pull you out of another voice channel. Decline asks Discord to stop ringing for you. Hang Up disconnects the current voice channel, including a server voice channel.

A successful response means the command was dispatched. It doesn't confirm that the voice connection has finished connecting.

CallDeck doesn't extract your Discord account token. The bridge password is stored in Vencord and Stream Deck settings without added encryption, so keep those settings out of public uploads.

## Development

```sh
node --experimental-strip-types --test vencord/tests/bridge.test.ts
node --test streamdeck/tests/plugin.test.cjs
npx @elgato/cli@1.10.1 validate streamdeck/com.nks.calldeck.sdPlugin
```

The bridge tests need Node 24 or newer. Vencord integration checks run inside a Vencord source checkout. The `ws` dependency is included with its MIT license.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE). Included dependencies keep their own licenses.

Built with Codex assistance and live-tested on my own setup. The artwork was generated with OpenAI image generation.

CallDeck is an independent project. It isn't endorsed by Discord, Vencord or Elgato.
