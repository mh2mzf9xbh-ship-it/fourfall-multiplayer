# Create a GitHub repository for Render deployment.
# PowerShell 7: pwsh -NoProfile -ExecutionPolicy Bypass -File .\PUBLISH_GITHUB.ps1
# Requires Git and GitHub CLI (gh), and a GitHub account.
param(
    [string]$RepositoryName = 'fourfall-multiplayer',
    [switch]$Private
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git is missing. Install it with: winget install --id Git.Git -e'
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI is missing. Install it with: winget install --id GitHub.cli -e'
}

& gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Log in to GitHub using the browser window or instructions shown...' -ForegroundColor Cyan
    & gh auth login
    if ($LASTEXITCODE -ne 0) { throw 'GitHub authentication was not completed.' }
}

$userName = (& git config user.name)
$userEmail = (& git config user.email)
if (-not $userName -or -not $userEmail) {
    Write-Host 'Git requires your own name and email before committing:' -ForegroundColor Yellow
    Write-Host 'git config --global user.name "Your name"'
    Write-Host 'git config --global user.email "your-github-email@example.com"'
    throw 'Configure your Git identity, then rerun this script.'
}

if (-not (Test-Path -LiteralPath '.git')) {
    & git init -b main
    if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }
}
& git add --all
if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    & git commit -m 'Build real-time Fourfall multiplayer game'
    if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }
}

$existingRemotes = @(& git remote)
if ($LASTEXITCODE -ne 0) { throw 'Unable to read Git remotes.' }
$remoteExists = ($existingRemotes -contains 'origin')
if ($remoteExists) {
    Write-Host 'Existing origin remote found. Pushing committed changes...' -ForegroundColor Cyan
    & git push -u origin HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Git push failed. Verify GitHub permissions.' }
} else {
    $visibility = if ($Private) { '--private' } else { '--public' }
    Write-Host "Creating GitHub repository: $RepositoryName ($visibility)" -ForegroundColor Cyan
    & gh repo create $RepositoryName $visibility --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { throw 'GitHub repository creation failed. Check whether the repository name is already in use in your account.' }
}
Write-Host 'GitHub repository published.' -ForegroundColor Green
Write-Host 'Next: go to https://dashboard.render.com/ and create a Web Service using this repository.'
& gh repo view --web
