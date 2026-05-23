param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

Set-Content -Path (Join-Path $Root "VERSION") -Value $Version -NoNewline

$PackageJson = Join-Path $Root "frontend\package.json"
$pkg = Get-Content $PackageJson -Raw | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 100 | Set-Content $PackageJson

Write-Host "Version set to $Version"
Write-Host "  VERSION"
Write-Host "  frontend/package.json"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  git checkout -b release/$Version"
Write-Host "  dotnet build backend/src/Carmasters.sln"
Write-Host "  cd frontend && npm install"
Write-Host "  git commit -am ""chore: release $Version"""
Write-Host "  git tag v$Version"
