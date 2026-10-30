# Fourfall multiplayer game launcher - PowerShell 7 / Windows
# Run: pwsh -NoProfile -ExecutionPolicy Bypass -File .\RUN_GAME.ps1
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host '=============================================' -ForegroundColor Cyan
Write-Host ' FOURFALL - TWO-PLAYER MULTIPLAYER GAME' -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Cyan

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'Node.js not found.' -ForegroundColor Yellow
    Write-Host 'Install the current LTS version, then reopen PowerShell:'
    Write-Host 'winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements' -ForegroundColor Green
    exit 1
}

$nodeVersion = (& node --version).Trim()
$major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
if ($major -lt 22) {
    Write-Host "Node.js $nodeVersion is too old. Use Node.js 22 or newer (LTS recommended)." -ForegroundColor Red
    exit 1
}

$env:PORT = [string]$Port
Write-Host "Node.js: $nodeVersion" -ForegroundColor Green
Write-Host "Local game: http://localhost:$Port" -ForegroundColor Green
Write-Host 'Once this server starts, open the URL above in your browser.'
Write-Host 'Keep this PowerShell window open while you play.'
Write-Host 'For players outside your home network, publish to Render using README.md.'
Write-Host 'Press Ctrl+C to stop the server.' -ForegroundColor Yellow
Write-Host ''

& node (Join-Path $PSScriptRoot 'server.js')
if ($LASTEXITCODE -ne 0) {
    throw "Game server stopped with exit code $LASTEXITCODE."
}
