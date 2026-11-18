[CmdletBinding()]
param(
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$env:COMFYUI_LOCAL_URL = 'http://127.0.0.1:8190'
$env:KIMI_API_URL = 'https://api.kimi.com/coding/v1'
$env:GROK_VIDEO_POLL_TIMEOUT_MS = '1800000'
$env:HTTP_PROXY = ''
$env:HTTPS_PROXY = ''
$env:ALL_PROXY = ''
$env:NO_PROXY = '127.0.0.1,localhost'

& npm.cmd run dev -- --port $Port
exit $LASTEXITCODE
