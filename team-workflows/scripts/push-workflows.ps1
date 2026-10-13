#Requires -Version 5.1
<#
.SYNOPSIS
  Stage, commit, and push workflow JSON + preset changes.

.PARAMETER Message
  Commit message. Default: "chore: sync team workflows"

.PARAMETER RepoRoot
  Git repo root (usually ComfyUI\user\comfytv\workflows). Default: parent of scripts/.

.EXAMPLE
  .\scripts\push-workflows.ps1
  .\scripts\push-workflows.ps1 -Message "feat(image): add brand t2i preset"
#>
param(
  [string]$Message = "chore: sync team workflows",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
  Write-Error "Not a git repo: $RepoRoot"
}

Push-Location $RepoRoot
try {
  Write-Host "Status before commit ($RepoRoot):"
  git status --short
  Write-Host ""

  # Track GUI workflows + presets; leave ignored sidecars alone
  git add -A -- .
  git status --short

  $pending = git status --porcelain
  if (-not $pending) {
    Write-Host "Nothing to commit."
    return
  }

  git commit -m $Message
  if ($LASTEXITCODE -ne 0) {
    Write-Error "git commit failed (exit $LASTEXITCODE)."
  }

  git push
  if ($LASTEXITCODE -ne 0) {
    Write-Error "git push failed (exit $LASTEXITCODE). Pull first if the remote moved."
  }

  Write-Host ""
  Write-Host "Pushed. Colleagues: run scripts\pull-and-hint.ps1 then reopen bottom-bar Workflows."
}
finally {
  Pop-Location
}
