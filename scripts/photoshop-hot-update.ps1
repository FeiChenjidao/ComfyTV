param([switch] $BuildFrontend)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$pluginRoot = Join-Path $projectRoot "photoshop-uxp-plugin"
$manifest = Get-Content -LiteralPath (Join-Path $pluginRoot "manifest.json") -Raw | ConvertFrom-Json
$version = [string] $manifest.version
$desktopRoot = "D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI"
$liveRoot = Join-Path $desktopRoot "custom_nodes\ComfyTV"
$userRoot = Join-Path $desktopRoot "user\comfytv\photoshop"
$statePath = Join-Path $userRoot "hot-update-state.json"

function Assert-Junction([string] $Path, [string] $Target) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Missing junction: $Path" }
    $item = Get-Item -LiteralPath $Path
    $actual = [string] ($item.Target -join "")
    if ($item.LinkType -ne "Junction" -or $actual -ne $Target) {
        throw "Unexpected junction: $Path -> $actual"
    }
}

function Invoke-Checked([string] $Command, [string[]] $Arguments) {
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}

function Hash-Set([string[]] $Files) {
    $result = [ordered] @{}
    foreach ($file in $Files) {
        if (-not (Test-Path -LiteralPath $file)) { throw "Missing required file: $file" }
        $relative = $file.Substring($projectRoot.Length).TrimStart('\')
        $result[$relative] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    }
    return $result
}

function Hashes-Differ($Before, $After) {
    if ($null -eq $Before) { return $true }
    foreach ($property in $After.PSObject.Properties) {
        if ([string] $Before.($property.Name) -ne [string] $property.Value) { return $true }
    }
    return $false
}

function Newest-WriteTime([string[]] $Files) {
    return ($Files | ForEach-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } |
        Sort-Object -Descending | Select-Object -First 1)
}

Assert-Junction $liveRoot $projectRoot
$appData = [Environment]::GetFolderPath("ApplicationData")
$programFiles = [Environment]::GetFolderPath("ProgramFiles")
$pluginFolder = "com.comfytv.photoshop.uxp_$version"
Assert-Junction (Join-Path $programFiles "Common Files\Adobe\UXP\Plugins\External\$pluginFolder") $pluginRoot
$localPluginPath = Join-Path $appData "Adobe\UXP\Plugins\External\$pluginFolder"
if (Test-Path -LiteralPath $localPluginPath) {
    throw "Duplicate local Photoshop plugin registration must be removed: $localPluginPath"
}

$pluginInfoPath = Join-Path $programFiles "Common Files\Adobe\UXP\PluginsInfo\v1\PS.json"
$pluginInfo = Get-Content -LiteralPath $pluginInfoPath -Raw | ConvertFrom-Json
$registration = $pluginInfo.plugins | Where-Object pluginId -eq $manifest.id
if (-not $registration) { throw "Adobe plugin registration is missing" }
if ($registration.versionString -ne $version -or $registration.path -notlike "*$pluginFolder") {
    throw "Adobe plugin registration is not aligned with manifest $version"
}
$localPluginInfoPath = Join-Path $appData "Adobe\UXP\PluginsInfo\v1\PS.json"
if (Test-Path -LiteralPath $localPluginInfoPath) {
    $localPluginInfo = Get-Content -LiteralPath $localPluginInfoPath -Raw | ConvertFrom-Json
    if ($localPluginInfo.plugins | Where-Object pluginId -eq $manifest.id) {
        throw "Duplicate user-level Photoshop registration must be removed: $localPluginInfoPath"
    }
}

if ($BuildFrontend) { Invoke-Checked "npm" @("run", "build:fast") }
Invoke-Checked "node" @("--check", (Join-Path $projectRoot "runtime\photoshop-runtime-bridge.js"))
Invoke-Checked "node" @("--check", (Join-Path $projectRoot "js\photoshop-runtime-bridge.js"))
Invoke-Checked "node" @("--check", (Join-Path $pluginRoot "preset-data.js"))
Invoke-Checked "node" @("--check", (Join-Path $pluginRoot "main.js"))
Invoke-Checked "node" @("--check", (Join-Path $pluginRoot "composer-web\composer.js"))
Invoke-Checked "python" @("-m", "py_compile", (Join-Path $projectRoot "photoshop\backend.py"), (Join-Path $projectRoot "photoshop\nodes.py"), (Join-Path $projectRoot "api\photoshop.py"))

$workflows = @(
    (Join-Path $projectRoot "dist\PS_NanoBanana_GPTImage.json"),
    (Join-Path $projectRoot "workflows\image\PS_NanoBanana_GPTImage.json"),
    (Join-Path $desktopRoot "user\default\workflows\PS_NanoBanana_GPTImage.json"),
    (Join-Path $desktopRoot "user\comfytv\workflows\image\PS_NanoBanana_GPTImage.json")
)
Invoke-Checked "node" (@((Join-Path $projectRoot "scripts\verify-photoshop-workflows.mjs")) + $workflows)

$hostRestartFiles = @(
    (Join-Path $pluginRoot "manifest.json"), (Join-Path $pluginRoot "index.html"),
    (Join-Path $pluginRoot "main.js"), (Join-Path $pluginRoot "preset-data.js"),
    (Join-Path $pluginRoot "styles.css")
)
$composerFiles = @(
    (Join-Path $pluginRoot "composer-web\index.html"),
    (Join-Path $pluginRoot "composer-web\composer.css"),
    (Join-Path $pluginRoot "composer-web\composer.js")
)
$hostFiles = $hostRestartFiles + $composerFiles
$serverFiles = @(
    (Join-Path $projectRoot "photoshop\backend.py"),
    (Join-Path $projectRoot "photoshop\nodes.py"),
    (Join-Path $projectRoot "api\photoshop.py"),
    (Join-Path $projectRoot "runtime\photoshop-runtime-bridge.js"),
    (Join-Path $projectRoot "js\main.js")
)
$hostHashes = Hash-Set $hostFiles
$serverHashes = Hash-Set $serverFiles
$previous = $null
if (Test-Path -LiteralPath $statePath) {
    try { $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json } catch { $previous = $null }
}
$photoshopProcess = Get-Process Photoshop -ErrorAction SilentlyContinue |
    Sort-Object StartTime -Descending | Select-Object -First 1
$comfyPython = Get-Process python -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "D:\Comfy-Desktop\*" } |
    Sort-Object StartTime -Descending | Select-Object -First 1
$registrationFiles = @($pluginInfoPath)
if (Test-Path -LiteralPath $localPluginInfoPath) { $registrationFiles += $localPluginInfoPath }
$hostChanged = $null -ne $photoshopProcess -and
    $photoshopProcess.StartTime.ToUniversalTime() -lt (Newest-WriteTime ($hostRestartFiles + $registrationFiles))
$serverChanged = $null -ne $comfyPython -and
    $comfyPython.StartTime.ToUniversalTime() -lt (Newest-WriteTime $serverFiles)
New-Item -ItemType Directory -Path $userRoot -Force | Out-Null
[ordered] @{ version = 1; checkedAt = (Get-Date).ToString("o"); host = $hostHashes; server = $serverHashes } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statePath -Encoding UTF8

$service = "ComfyUI is not reachable."
try {
    $status = Invoke-RestMethod -Uri "http://localhost:8188/comfytv/photoshop/status" -TimeoutSec 3
    $service = "ComfyUI bridge is reachable."
} catch {}

Write-Host ""
Write-Host "ComfyTV Photoshop verification passed." -ForegroundColor Green
Write-Host $service
if ($serverChanged) { Write-Host "Restart Comfy Desktop once: backend, node schema, or frontend runtime changed." -ForegroundColor Yellow }
else { Write-Host "Comfy Desktop restart is not required." }
if ($hostChanged) { Write-Host "Restart Photoshop once: UXP host files changed." -ForegroundColor Yellow }
else { Write-Host "Photoshop restart is not required." }
