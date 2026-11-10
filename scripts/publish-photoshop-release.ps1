param(
    [Parameter(Mandatory = $true)]
    [string] $ReleaseNotes,
    [switch] $Publish,
    [switch] $SkipPackage
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $projectRoot "photoshop-uxp-plugin\manifest.json"
$pluginManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = [string] $pluginManifest.version
$tag = "v$version"
$distRoot = Join-Path $projectRoot "dist"
$packageName = "ComfyTV-photoshop-$version.ccx"
$hashName = "$packageName.sha256.txt"
$packagePath = Join-Path $distRoot $packageName
$hashPath = Join-Path $distRoot $hashName
$repository = "FeiChenjidao/ComfyTV-Photoshop"

if (-not $SkipPackage) {
    & (Join-Path $PSScriptRoot "package-photoshop-plugin.ps1")
    if ($LASTEXITCODE -ne 0) { throw "Photoshop package verification failed" }
}

if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { throw "Missing release package: $packagePath" }
if (-not (Test-Path -LiteralPath $hashPath -PathType Leaf)) { throw "Missing release hash: $hashPath" }

$expectedHash = ((Get-Content -LiteralPath $hashPath -Raw) -split '\s+')[0].Trim().ToUpperInvariant()
$actualHash = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToUpperInvariant()
if ($expectedHash -ne $actualHash) { throw "CCX hash does not match $hashName" }

$credentialText = "protocol=https`nhost=github.com`n`n" | git credential fill
$credential = @{}
foreach ($line in $credentialText) {
    $parts = $line -split '=', 2
    if ($parts.Count -eq 2) { $credential[$parts[0]] = $parts[1] }
}
$token = [string] $credential['password']
if ([string]::IsNullOrWhiteSpace($token)) { throw "GitHub credential is unavailable. Sign in with Git Credential Manager first." }

$headers = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github+json"
    'X-GitHub-Api-Version' = "2022-11-28"
    'User-Agent' = "ComfyTV-Photoshop-Release-Publisher"
}
$apiRoot = "https://api.github.com/repos/$repository"
$existingRelease = $null
try {
    $existingRelease = Invoke-RestMethod -Method Get -Uri "$apiRoot/releases/tags/$tag" -Headers $headers
} catch {
    if (-not $_.Exception.Response.StatusCode -or [int] $_.Exception.Response.StatusCode -ne 404) { throw }
}
if ($existingRelease) { throw "Release $tag already exists. Bump the plugin version before publishing again." }

$releaseBody = @{
    tag_name = $tag
    target_commitish = "main"
    name = "ComfyTV Photoshop $version"
    body = $ReleaseNotes
    draft = $true
    prerelease = $false
} | ConvertTo-Json
$release = Invoke-RestMethod -Method Post -Uri "$apiRoot/releases" -Headers $headers -Body $releaseBody -ContentType "application/json"
$uploadRoot = ([string] $release.upload_url) -replace '\{\?name,label\}$', ''

function Send-ReleaseAsset([string] $Path, [string] $Name, [string] $ContentType) {
    $uri = "$uploadRoot`?name=$([Uri]::EscapeDataString($Name))"
    Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -InFile $Path -ContentType $ContentType | Out-Null
}

try {
    Send-ReleaseAsset $packagePath $packageName "application/octet-stream"
    Send-ReleaseAsset $hashPath $hashName "text/plain"
} catch {
    Write-Warning "Release was created but an asset upload failed. Open the draft and repair it before publishing."
    throw
}

if ($Publish) {
    $release = Invoke-RestMethod -Method Patch -Uri "$apiRoot/releases/$($release.id)" -Headers $headers -Body (@{ draft = $false } | ConvertTo-Json) -ContentType "application/json"
    $currentManifest = Invoke-RestMethod -Method Get -Uri "$apiRoot/contents/latest.json?ref=main" -Headers $headers
    $downloadRoot = "https://github.com/$repository/releases/download/$tag"
    $updateManifest = [ordered] @{
        schema = 1
        published = $true
        repository = $repository
        version = $version
        name = "ComfyTV Photoshop $version"
        notes = $ReleaseNotes
        publishedAt = (Get-Date).ToUniversalTime().ToString("o")
        minimumPhotoshopVersion = [string] $pluginManifest.host.minVersion
        packageName = $packageName
        packageSize = (Get-Item -LiteralPath $packagePath).Length
        packageUrl = "$downloadRoot/$packageName"
        hashUrl = "$downloadRoot/$hashName"
        releaseUrl = [string] $release.html_url
    }
    $manifestJson = $updateManifest | ConvertTo-Json -Depth 5
    $manifestPayload = @{
        message = "Publish Photoshop $version update feed"
        content = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($manifestJson + "`n"))
        sha = [string] $currentManifest.sha
        branch = "main"
    } | ConvertTo-Json
    Invoke-RestMethod -Method Put -Uri "$apiRoot/contents/latest.json" -Headers $headers -Body $manifestPayload -ContentType "application/json" | Out-Null
}

Write-Host ""
Write-Host "Photoshop release uploaded." -ForegroundColor Green
Write-Host "Repository: https://github.com/$repository"
Write-Host "Tag: $tag"
Write-Host "State: $(if ($Publish) { 'published; latest.json updated' } else { 'draft; latest.json unchanged' })"
Write-Host "Assets: $packageName, $hashName"
Write-Host "Release: $($release.html_url)"
