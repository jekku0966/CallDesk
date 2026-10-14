param(
    [Parameter(Mandatory=$true)][ValidateSet('status','answer','decline','hangup')][string]$Action,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Token,
    [ValidateRange(1024,65535)][int]$Port = 9473
)
$method = if ($Action -eq 'status') { 'Get' } else { 'Post' }
try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$Port/$Action" -Method $method -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 8 | ConvertTo-Json -Depth 5
} catch {
    $failure = $_
    $response = $failure.Exception.Response
    $httpStatus = if ($response) { [int]$response.StatusCode } else { $null }
    $details = $failure.ErrorDetails.Message
    # Windows PowerShell 5.1 often leaves the JSON error body in the response stream.
    if (-not $details -and $response -and $response.PSObject.Methods['GetResponseStream']) {
        $stream = $response.GetResponseStream()
        if ($stream) {
            $reader = New-Object System.IO.StreamReader($stream)
            try { $details = $reader.ReadToEnd() } finally { $reader.Dispose() }
        }
    }
    $reason = $failure.Exception.Message
    if ($details) {
        try {
            $body = $details | ConvertFrom-Json -ErrorAction Stop
            if ($body.error -is [string]) { $reason = $body.error }
        } catch { }
    }
    $message = if ($httpStatus) { "CallDeck HTTP ${httpStatus}: $reason" } else { "CallDeck request failed: $reason" }
    Write-Error -Message $message -ErrorAction Continue
    exit 1
}
