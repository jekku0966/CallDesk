# CallDeck — GPL-3.0-or-later
# Dependency-free, deterministic V2 profile archives. Structure checked against
# Elgato's official Lights Out sample; no user profiles or credentials are copied.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$plugin = Join-Path $PSScriptRoot '..\com.nks.calldeck.sdPlugin'
$output = Join-Path $plugin 'profiles'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$models = @(
    [ordered]@{ Name = 'Standard'; Model = '20GAA9902'; Type = 0 },
    [ordered]@{ Name = 'Mini'; Model = '20GAI9901'; Type = 1 },
    [ordered]@{ Name = 'XL'; Model = '20GAT9902'; Type = 2 },
    [ordered]@{ Name = 'Plus'; Model = '20GBD9901'; Type = 7 },
    [ordered]@{ Name = 'Neo'; Model = '20GBJ9901'; Type = 9 }
)
function Get-ProfileFolder([string]$uuid) {
    $hex = $uuid.Replace('-', '')
    $alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUV'
    $bits = 0; $buffer = 0; $encoded = ''
    for ($i = 0; $i -lt $hex.Length; $i += 2) {
        $buffer = ($buffer -shl 8) -bor [Convert]::ToInt32($hex.Substring($i, 2), 16)
        $bits += 8
        while ($bits -ge 5) { $bits -= 5; $encoded += $alphabet[($buffer -shr $bits) -band 31] }
        $buffer = $buffer -band ((1 -shl $bits) - 1)
    }
    if ($bits) { $encoded += $alphabet[($buffer -shl (5 - $bits)) -band 31] }
    return $encoded + 'Z'
}
function Add-Json($archive, [string]$name, $value) {
    $entry = $archive.CreateEntry($name)
    $entry.LastWriteTime = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write(($value | ConvertTo-Json -Depth 20 -Compress)) } finally { $writer.Dispose() }
}
foreach ($device in $models) {
    $suffix = '{0:D12}' -f $device.Type
    $root = "A6938BD3-AC88-4F63-883F-$suffix.sdProfile"
    $page = "f64658d3-7226-421a-8c30-$suffix"
    $fallback = "9dcf0a88-7c67-4d13-b672-$suffix"
    $path = Join-Path $output ('CallDeck-' + $device.Name + '.streamDeckProfile')
    $stream = [IO.File]::Open($path, [IO.FileMode]::Create)
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        Add-Json $archive "$root/manifest.json" ([ordered]@{
            Device = [ordered]@{ Model = $device.Model; UUID = '' }; Name = 'CallDeck Incoming - ' + $device.Name
            Pages = [ordered]@{ Current = $page; Default = $fallback; Pages = @($page) }; Version = '2.0'
        })
        $actions = [ordered]@{}; $index = 0
        foreach ($name in @('answer', 'decline', 'hangup', 'return')) {
            $position = if ($index -eq 3) { '0,1' } else { "$index,0" }
            $actions[$position] = [ordered]@{
                ActionID = "e85a70d$index-209e-43a5-9780-$suffix"; LinkedTitle = $true
                Name = if ($name -eq 'return') { 'Back' } else { $name }
                Settings = [ordered]@{ autoProfile = 'calldeck-incoming-v1' }; State = 0
                States = @([ordered]@{ ShowTitle = ($name -eq 'return'); Title = if ($name -eq 'return') { 'Back' } else { '' }; TitleAlignment = 'middle'; TitleColor = '#ffffff'; FontSize = 12 })
                UUID = "com.nks.calldeck.$name"
            }
            $index++
        }
        Add-Json $archive "$root/Profiles/$(Get-ProfileFolder $page)/manifest.json" ([ordered]@{ Controllers = @([ordered]@{ Actions = $actions; Type = 'Keypad' }); Icon = ''; Name = '' })
        Add-Json $archive "$root/Profiles/$(Get-ProfileFolder $fallback)/manifest.json" ([ordered]@{ Controllers = @([ordered]@{ Actions = [ordered]@{}; Type = 'Keypad' }); Icon = ''; Name = '' })
    } finally { $archive.Dispose(); $stream.Dispose() }
    Write-Output $path
}
