param(
    [Parameter(Mandatory=$true)][ValidateSet('status','answer','decline','hangup')][string]$Action,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Token,
    [ValidateRange(1024,65535)][int]$Port = 9473
)
$method = if ($Action -eq 'status') { 'Get' } else { 'Post' }
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/$Action" -Method $method -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 8 | ConvertTo-Json -Depth 5
} catch {
    Write-Error $_
    exit 1
}
