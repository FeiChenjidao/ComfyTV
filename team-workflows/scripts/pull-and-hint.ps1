#Requires -Version 5.1
<#
.SYNOPSIS
  Pull the latest team workflows, then remind you to Rescan in ComfyTV.

.DESCRIPTION
  Run from anywhere. If you pass -RepoRoot, that directory is used;
  otherwise the parent of this scripts/ folder is treated as the repo root
  (i.e. your clone of user/comfytv/workflows).

.EXAMPLE
  .\scripts\pull-and-hint.ps1
  .\scripts\pull-and-hint.ps1 -RepoRoot "D:\ComfyUI\ComfyUI\user\comfytv\workflows"
#>
param(
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $RepoRoot) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
  Write-Error "Not a git repo: $RepoRoot`nClone the team workflows repo into ComfyUI\user\comfytv\workflows first."
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
  Write-Host "Next: open ComfyTV sidebar -> Stages / Workflows -> Rescan"
  Write-Host "      (重新扫描). Bottom bar and stage dropdowns will refresh."
}
finally {
  Pop-Location
}
