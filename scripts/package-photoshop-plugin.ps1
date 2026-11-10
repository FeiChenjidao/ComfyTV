param(
    [switch] $KeepStaging
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$pluginRoot = Join-Path $projectRoot "photoshop-uxp-plugin"
$distRoot = Join-Path $projectRoot "dist"
$manifestPath = Join-Path $pluginRoot "manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string] $manifest.version
if ([version] ([string] $manifest.host.minVersion) -lt [version] "26.0.0") {
    throw "Photoshop 26.0 or newer is required for the local Composer WebView"
}
$mainSource = Get-Content -LiteralPath (Join-Path $pluginRoot "main.js") -Raw
if ($mainSource -notmatch ('const PLUGIN_VERSION = "' + [regex]::Escape($version) + '"')) {
    throw "main.js PLUGIN_VERSION does not match manifest version $version"
}
if ($mainSource -match '/comfytv/photoshop/composer') {
    throw "The Composer must load from the plugin package, not from ComfyUI"
}
$nodeMetadata = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$nodeVersion = [string] $nodeMetadata.version
$packageBase = "ComfyTV-photoshop-$version"
$ccxPath = Join-Path $distRoot "$packageBase.ccx"
$packageHashPath = Join-Path $distRoot "$packageBase.ccx.sha256.txt"
$fileHashPath = Join-Path $distRoot "$packageBase-files.sha256.txt"
$manualPluginPath = Join-Path $distRoot "$packageBase-手动安装.zip"
$nodePackageName = "ComfyTV-custom-node-$nodeVersion.zip"
$nodePackagePath = Join-Path $distRoot $nodePackageName
$nodePackageHashPath = Join-Path $distRoot "$nodePackageName.sha256.txt"
$bundlePath = Join-Path $distRoot "ComfyTV-Photoshop-$version-同事安装包.zip"
$bundleHashPath = Join-Path $distRoot "ComfyTV-Photoshop-$version-同事安装包.zip.sha256.txt"
$guidePath = Join-Path $distRoot "安装说明.txt"
$workflowPath = Join-Path $distRoot "PS_NanoBanana_GPTImage.json"
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempBase ("comfytv-photoshop-package-" + [guid]::NewGuid().ToString("N"))
$stageRoot = Join-Path $tempRoot "plugin"
$verifyRoot = Join-Path $tempRoot "verify"
$bundleRoot = Join-Path $tempRoot "bundle"
$manualVerifyRoot = Join-Path $tempRoot "manual-verify"
$nodeStageParent = Join-Path $tempRoot "custom-node"
$nodeStageRoot = Join-Path $nodeStageParent "ComfyTV"
$nodeVerifyParent = Join-Path $tempRoot "custom-node-verify"
$nodeVerifyRoot = Join-Path $nodeVerifyParent "ComfyTV"
$zipPath = Join-Path $tempRoot "$packageBase.zip"

function Get-RelativePath([string] $Path, [string] $Base) {
    return $Path.Substring($Base.Length).TrimStart('\', '/')
}

function Get-PackageFiles([string] $Root) {
    return Get-ChildItem -LiteralPath $Root -Recurse -File | Where-Object {
        $relative = Get-RelativePath $_.FullName $Root
        $segments = $relative -split '[\\/]'
        $retiredAssets = @(
            'icon-live-toggle.jpg',
            'icons\live-toggle.gif',
            'icons\live-toggle.png'
        )
        $segments[0] -notlike 'backup-*' -and
            $relative -ne 'README.md' -and
            $relative -notin $retiredAssets -and
            $relative -notlike '*.bak' -and
            $relative -notlike '*.tmp' -and
            $relative -notlike '*.log' -and
            $relative -notlike '*.DS_Store' -and
            $relative -notlike '*Thumbs.db'
    } | Sort-Object FullName
}

function Assert-RequiredFiles([string] $Root) {
    $required = @(
        'manifest.json',
        'index.html',
        'main.js',
        'direct-api.js',
        'updater.js',
        'styles.css',
        'icons.js',
        'glass.js',
        'preset-data.js',
        'preview-default.jpg',
        'composer-web\index.html',
        'composer-web\composer.css',
        'composer-web\composer.js'
    )
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
            throw "Missing required Photoshop plugin file: $relative"
        }
    }
}

function Copy-PackageFiles([string] $Source, [string] $Destination) {
    foreach ($file in Get-PackageFiles $Source) {
        $relative = Get-RelativePath $file.FullName $Source
        $target = Join-Path $Destination $relative
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
}

function Get-CustomNodeFiles([string] $Root) {
    $rootFiles = @(
        '__init__.py', 'backup.py', 'db.py', 'settings.py', 'skill_store.py',
        'pyproject.toml', 'LICENSE', 'README.md', 'README.zh.md',
        'comfytv.properties.temp'
    )
    $runtimeDirectories = @(
        'api', 'assets', 'bot', 'js', 'locales', 'mesh3d', 'node-docs', 'nodes',
        'photoshop', 'runners', 'runtime', 'skills', 'storage', 'team-workflows', 'workflows'
    )
    $files = @()
    foreach ($relative in $rootFiles) {
        $path = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Missing required ComfyTV runtime file: $relative"
        }
        $files += Get-Item -LiteralPath $path
    }
    foreach ($relative in $runtimeDirectories) {
        $path = Join-Path $Root $relative
        if (-not (Test-Path -LiteralPath $path -PathType Container)) {
            throw "Missing required ComfyTV runtime directory: $relative"
        }
        $files += Get-ChildItem -LiteralPath $path -Recurse -File -Force | Where-Object {
            $itemRelative = Get-RelativePath $_.FullName $Root
            $segments = $itemRelative -split '[\\/]'
            '__pycache__' -notin $segments -and
                '.pytest_cache' -notin $segments -and
                $itemRelative -ne 'runners\config.json' -and
                $itemRelative -notlike 'photoshop\data\*' -and
                $_.Extension -notin @('.pyc', '.pyo', '.map', '.log', '.tmp') -and
                $_.Name -notin @('.DS_Store', 'Thumbs.db')
        }
    }
    return $files | Sort-Object FullName -Unique
}

function Copy-CustomNodeFiles([string] $Source, [string] $Destination) {
    foreach ($file in Get-CustomNodeFiles $Source) {
        $relative = Get-RelativePath $file.FullName $Source
        $target = Join-Path $Destination $relative
        New-Item -ItemType Directory -Path (Split-Path $target) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target
    }
}

function Assert-CustomNodeFiles([string] $Root) {
    $required = @(
        '__init__.py', 'pyproject.toml', 'js\main.js',
        'js\photoshop-runtime-bridge.js', 'runtime\photoshop-runtime-bridge.js',
        'api\photoshop.py', 'photoshop\__init__.py', 'photoshop\backend.py',
        'photoshop\nodes.py', 'workflows\image\PS_NanoBanana_GPTImage.json'
    )
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $relative) -PathType Leaf)) {
            throw "Packaged ComfyTV runtime is missing: $relative"
        }
    }
    $runtimeHash = (Get-FileHash -LiteralPath (Join-Path $Root 'runtime\photoshop-runtime-bridge.js') -Algorithm SHA256).Hash
    $frontendHash = (Get-FileHash -LiteralPath (Join-Path $Root 'js\photoshop-runtime-bridge.js') -Algorithm SHA256).Hash
    if ($runtimeHash -ne $frontendHash) { throw "Photoshop runtime bridge copies do not match" }
}

function Get-HashMap([string] $Root) {
    $map = [ordered] @{}
    foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File | Sort-Object FullName) {
        $relative = (Get-RelativePath $file.FullName $Root).Replace('\', '/')
        $map[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return $map
}

function Assert-HashMapsEqual($Expected, $Actual) {
    $expectedKeys = @($Expected.Keys)
    $actualKeys = @($Actual.Keys)
    if ($expectedKeys.Count -ne $actualKeys.Count) {
        throw "Package file count mismatch: expected $($expectedKeys.Count), extracted $($actualKeys.Count)"
    }
    foreach ($relative in $expectedKeys) {
        if (-not $Actual.Contains($relative)) { throw "Packaged file is missing: $relative" }
        if ($Expected[$relative] -ne $Actual[$relative]) { throw "Packaged file hash mismatch: $relative" }
    }
}

function Invoke-NodeCheck([string] $Path) {
    & node --check $Path
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $Path" }
}

function Invoke-PythonSyntaxCheck([string] $Root) {
    $script = "import ast,pathlib,sys,tokenize; root=pathlib.Path(sys.argv[1]); [ast.parse(tokenize.open(str(p)).read(), filename=str(p)) for p in root.rglob('*.py')]"
    & python -c $script $Root
    if ($LASTEXITCODE -ne 0) { throw "Python syntax check failed: $Root" }
}

function Remove-SafeTemp([string] $Path) {
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove non-temporary path: $resolved"
    }
    if (Test-Path -LiteralPath $resolved) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

if ($manifest.id -ne 'com.comfytv.photoshop.uxp') { throw "Unexpected plugin id: $($manifest.id)" }
if ($manifest.manifestVersion -ne 5) { throw "Unexpected manifest version: $($manifest.manifestVersion)" }
if (-not $nodeVersion) { throw "ComfyTV package.json has no version" }
Assert-RequiredFiles $pluginRoot
if (-not (Test-Path -LiteralPath $guidePath -PathType Leaf)) { throw "Missing installation guide: $guidePath" }
if (-not (Test-Path -LiteralPath $workflowPath -PathType Leaf)) { throw "Missing Photoshop workflow: $workflowPath" }

New-Item -ItemType Directory -Path $distRoot, $stageRoot, $verifyRoot, $bundleRoot, $manualVerifyRoot, $nodeStageRoot, $nodeVerifyParent -Force | Out-Null
Copy-PackageFiles $pluginRoot $stageRoot
Assert-RequiredFiles $stageRoot
Copy-CustomNodeFiles $projectRoot $nodeStageRoot
Assert-CustomNodeFiles $nodeStageRoot

$unexpected = Get-ChildItem -LiteralPath $stageRoot -Recurse | Where-Object {
    $_.Name -like 'backup-*' -or $_.Name -eq 'README.md'
}
if ($unexpected) { throw "Development-only files entered the package: $($unexpected.FullName -join ', ')" }

Invoke-NodeCheck (Join-Path $stageRoot 'main.js')
Invoke-NodeCheck (Join-Path $stageRoot 'direct-api.js')
Invoke-NodeCheck (Join-Path $stageRoot 'updater.js')
Invoke-NodeCheck (Join-Path $stageRoot 'preset-data.js')
Invoke-NodeCheck (Join-Path $stageRoot 'composer-web\composer.js')
Invoke-NodeCheck (Join-Path $nodeStageRoot 'runtime\photoshop-runtime-bridge.js')
Invoke-NodeCheck (Join-Path $nodeStageRoot 'js\photoshop-runtime-bridge.js')
Invoke-NodeCheck (Join-Path $nodeStageRoot 'js\main.js')
Invoke-PythonSyntaxCheck $nodeStageRoot

$stageManifest = Get-Content -LiteralPath (Join-Path $stageRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($stageManifest.version -ne $version -or $stageManifest.id -ne $manifest.id) {
    throw "Staged manifest does not match the source manifest"
}

$expectedHashes = Get-HashMap $stageRoot
Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal
Expand-Archive -LiteralPath $zipPath -DestinationPath $verifyRoot
$actualHashes = Get-HashMap $verifyRoot
Assert-HashMapsEqual $expectedHashes $actualHashes

Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $manualPluginPath -CompressionLevel Optimal -Force
Expand-Archive -LiteralPath $manualPluginPath -DestinationPath $manualVerifyRoot
$manualHashes = Get-HashMap $manualVerifyRoot
Assert-HashMapsEqual $expectedHashes $manualHashes

$nodeExpectedHashes = Get-HashMap $nodeStageRoot
Compress-Archive -Path $nodeStageRoot -DestinationPath $nodePackagePath -CompressionLevel Optimal -Force
Expand-Archive -LiteralPath $nodePackagePath -DestinationPath $nodeVerifyParent
Assert-CustomNodeFiles $nodeVerifyRoot
$nodeActualHashes = Get-HashMap $nodeVerifyRoot
Assert-HashMapsEqual $nodeExpectedHashes $nodeActualHashes

Move-Item -LiteralPath $zipPath -Destination $ccxPath -Force
$ccxHash = (Get-FileHash -LiteralPath $ccxPath -Algorithm SHA256).Hash
"$ccxHash  $packageBase.ccx" | Set-Content -LiteralPath $packageHashPath -Encoding UTF8
$expectedHashes.GetEnumerator() | ForEach-Object { "$($_.Value)  $($_.Key)" } |
    Set-Content -LiteralPath $fileHashPath -Encoding UTF8
$nodePackageHash = (Get-FileHash -LiteralPath $nodePackagePath -Algorithm SHA256).Hash
"$nodePackageHash  $nodePackageName" | Set-Content -LiteralPath $nodePackageHashPath -Encoding UTF8

Copy-Item -LiteralPath $ccxPath, $packageHashPath, $fileHashPath, $manualPluginPath, $nodePackagePath, $nodePackageHashPath, $guidePath, $workflowPath -Destination $bundleRoot
$bundleContentsHashPath = Join-Path $bundleRoot '完整包文件校验.sha256.txt'
Get-ChildItem -LiteralPath $bundleRoot -File | Sort-Object Name | ForEach-Object {
    "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)  $($_.Name)"
} | Set-Content -LiteralPath $bundleContentsHashPath -Encoding UTF8
Compress-Archive -Path (Join-Path $bundleRoot '*') -DestinationPath $bundlePath -CompressionLevel Optimal -Force
$bundleHash = (Get-FileHash -LiteralPath $bundlePath -Algorithm SHA256).Hash
"$bundleHash  $(Split-Path $bundlePath -Leaf)" | Set-Content -LiteralPath $bundleHashPath -Encoding UTF8

$packageSize = (Get-Item -LiteralPath $ccxPath).Length
$nodePackageSize = (Get-Item -LiteralPath $nodePackagePath).Length
$bundleSize = (Get-Item -LiteralPath $bundlePath).Length
Write-Host ""
Write-Host "Photoshop plugin package verified." -ForegroundColor Green
Write-Host "Version: $version"
Write-Host "Files: $($expectedHashes.Count)"
Write-Host "CCX: $ccxPath ($packageSize bytes)"
Write-Host "ComfyTV runtime: $nodePackagePath ($nodePackageSize bytes, $($nodeExpectedHashes.Count) files)"
Write-Host "Bundle: $bundlePath ($bundleSize bytes)"
Write-Host "SHA256: $ccxHash"
Write-Host "Bundle SHA256: $bundleHash"
Write-Host "Release repository: https://github.com/FeiChenjidao/ComfyTV-Photoshop/releases"
Write-Host "Release tag: v$version"
Write-Host "Upload assets: $(Split-Path $ccxPath -Leaf), $(Split-Path $packageHashPath -Leaf)"

if ($KeepStaging) {
    Write-Host "Staging kept at: $tempRoot"
} else {
    Remove-SafeTemp $tempRoot
}
