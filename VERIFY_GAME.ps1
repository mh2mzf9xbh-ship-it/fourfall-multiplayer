# Verify the source files match the downloaded package manifest.
# pwsh -NoProfile -ExecutionPolicy Bypass -File .\VERIFY_GAME.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$manifest = Join-Path $PSScriptRoot 'SHA256_MANIFEST.txt'
if (-not (Test-Path -LiteralPath $manifest)) { throw 'SHA256_MANIFEST.txt is missing.' }
$checked = 0
foreach ($line in Get-Content -LiteralPath $manifest) {
    if ($line -notmatch '^([a-fA-F0-9]{64})  (.+)$') { throw "Invalid manifest entry: $line" }
    $expected = $Matches[1]
    $relative = $Matches[2]
    $file = Join-Path $PSScriptRoot $relative
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing file: $relative" }
    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if ($actual -ine $expected) { throw "SHA-256 mismatch: $relative" }
    $checked++
}
Write-Host "PASS: $checked source files match SHA-256 manifest." -ForegroundColor Green
