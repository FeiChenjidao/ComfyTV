#Requires -Version 5.1
<#
.SYNOPSIS
  Pull the latest shared native workflows, then remind you to refresh the bottom bar.

.DESCRIPTION
  Repo root should be ComfyUI\user\default\workflows (not user\comfytv\workflows).

.EXAMPLE
  .\scripts\pull-and-hint.ps1
  .\scripts\pull-and-hint.ps1 -RepoRoot "D:\ComfyUI\ComfyUI\user\default\workflows"
#>
param(
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
  Write-Error "Not a git repo: $RepoRoot`nClone the team workflows repo into ComfyUI\user\default\workflows first."
}

Push-Location $RepoRoot
try {
  Write-Host "git pull in $RepoRoot ..."
  git pull
  if ($LASTEXITCODE -ne 0) {
    Write-Error "git pull failed (exit $LASTEXITCODE). Resolve conflicts, then retry."
  }
  Write-Host ""
  Write-Host "Pull OK."
  Write-Host "Next: open ComfyTV bottom bar -> Workflows (close & reopen to refresh)."
  Write-Host "      Files live under user/default/workflows (native canvas graphs)."
}
finally {
  Pop-Location
}
