$body = @{
    model = "claude-sonnet-4-6"
    messages = @(@{role="user"; content="hi"})
    max_tokens = 10
} | ConvertTo-Json -Compress

if (-not $env:PRISM_API_KEY) {
    Write-Error "Set PRISM_API_KEY in the environment before running this script."
    exit 1
}

$headers = @{
    "Content-Type" = "application/json"
    "Authorization" = "Bearer $($env:PRISM_API_KEY)"
}

$endpoints = @(
    "https://ai.prism.uno/v1/chat/completions",
    "https://ai.prism.uno/api/chat/completions",
    "https://ai.prism.uno/openai/v1/chat/completions"
)

foreach ($ep in $endpoints) {
    try {
        Write-Host "Testing: $ep"
        $r = Invoke-WebRequest -Uri $ep -Method POST -Headers $headers -Body $body -TimeoutSec 30
        Write-Host "  SUCCESS: $($r.StatusCode) - $($r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)))"
    } catch {
        Write-Host "  FAILED: $($_.Exception.Message)"
    }
    Write-Host ""
}
