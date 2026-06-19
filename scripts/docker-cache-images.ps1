param(
  [switch]$Refresh
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$images = @(
  "node:24-slim",
  "busybox:latest",
  "paradedb/paradedb:latest-pg17",
  "redis:7-alpine",
  "rustfs/rustfs:latest",
  "minio/mc:latest",
  "searxng/searxng"
)

foreach ($image in $images) {
  docker image inspect $image *> $null
  if ($LASTEXITCODE -eq 0 -and -not $Refresh) {
    Write-Host "Cached $image"
    continue
  }

  Write-Host "Pulling $image"
  docker pull $image
}
