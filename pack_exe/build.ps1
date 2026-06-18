$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "dist"
$node = (Get-Command node -ErrorAction Stop).Source
$postject = Join-Path $root "node_modules\.bin\postject.cmd"

function ConvertFrom-CodePoints {
  param([int[]]$CodePoints)
  return -join ($CodePoints | ForEach-Object { [char]$_ })
}

$releaseName = ConvertFrom-CodePoints 0x53D1, 0x5E03
$appName = "LOF" + (ConvertFrom-CodePoints 0x5957, 0x5229, 0x76D1, 0x63A7) + ".exe"
$installerName = "LOF" + (ConvertFrom-CodePoints 0x5957, 0x5229, 0x76D1, 0x63A7, 0x5B89, 0x88C5, 0x5305) + ".exe"
$userGuideName = ConvertFrom-CodePoints 0x7528, 0x6237, 0x4F7F, 0x7528, 0x8BF4, 0x660E
$developerGuideName = ConvertFrom-CodePoints 0x5F00, 0x53D1, 0x4F7F, 0x7528, 0x8BF4, 0x660E
$release = Join-Path $root $releaseName

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

Set-Location $root
New-Item -ItemType Directory -Force -Path $dist, $release | Out-Null

if (-not (Test-Path $postject)) {
  $env:npm_config_cache = Join-Path $root ".npm-cache"
  Invoke-Checked "npm.cmd" "install"
}

Write-Host "[1/5] Generating application payload..."
Invoke-Checked $node (Join-Path $root "pack_exe\generate_sea_entry.js")
Invoke-Checked $node "--experimental-sea-config" (Join-Path $dist "sea-config.json")

Write-Host "[2/5] Building application EXE..."
$appExe = Join-Path $dist "LOF_Arbitrage_Monitor.exe"
Copy-Item -Force $node $appExe
Invoke-Checked $postject $appExe "NODE_SEA_BLOB" (Join-Path $dist "sea-prep.blob") "--sentinel-fuse" "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
Invoke-Checked $node (Join-Path $root "pack_exe\patch_windows_subsystem.js") $appExe
Copy-Item -Force $appExe (Join-Path $dist $appName)
Copy-Item -Force $appExe (Join-Path $release $appName)
Copy-Item -Force (Join-Path $root "funds_config.json") (Join-Path $release "funds_config.json")

Write-Host "[3/5] Generating installer payload..."
Invoke-Checked $node (Join-Path $root "pack_exe\generate_installer_embedded.js")
Invoke-Checked $node "--experimental-sea-config" (Join-Path $dist "installer-embedded-config.json")

Write-Host "[4/5] Building installer EXE..."
$installerExe = Join-Path $dist "LOF_Installer.exe"
Copy-Item -Force $node $installerExe
Invoke-Checked $postject $installerExe "NODE_SEA_BLOB" (Join-Path $dist "installer-embedded-prep.blob") "--sentinel-fuse" "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
Invoke-Checked $node (Join-Path $root "pack_exe\patch_windows_subsystem.js") $installerExe
Copy-Item -Force $installerExe (Join-Path $release $installerName)

Write-Host "[5/5] Copying documentation..."
Copy-Item -Force (Join-Path $root "USER_GUIDE.md") (Join-Path $release ($userGuideName + ".md"))
Copy-Item -Force (Join-Path $root "DEVELOPER_GUIDE.md") (Join-Path $release ($developerGuideName + ".md"))

Write-Host "Build complete: $release"
