# Run in another PowerShell 7 window:
# pwsh -NoProfile -ExecutionPolicy Bypass -File .\TEST_GAME.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Install Node.js LTS first: winget install --id OpenJS.NodeJS.LTS -e'
}
Write-Host 'Running automated gameplay and server tests...' -ForegroundColor Cyan
& node --test
if ($LASTEXITCODE -ne 0) {
    throw 'At least one automated test failed. Please save the output and share it with ChatGPT.'
}
Write-Host 'PASS: All tests passed.' -ForegroundColor Green
