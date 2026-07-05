$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outRoot = Join-Path $root "dist_publicacion"
$dest = Join-Path $outRoot "proyekta-portal-agencias-publicable_$stamp"
$zip = "$dest.zip"

if (!(Test-Path $outRoot)) {
  New-Item -ItemType Directory -Path $outRoot | Out-Null
}

New-Item -ItemType Directory -Path $dest | Out-Null

$include = @(
  "package.json",
  "README.md",
  ".env.example",
  ".gitignore",
  ".dockerignore",
  "Dockerfile",
  "render.yaml",
  "GUIA_PUBLICAR_PORTAL_AGENCIAS.txt",
  "GUIA_CONTRATOS_AGENCIAS.txt",
  "GUIA_ADMIN_RAPIDA.txt",
  "GUIA_CORREO_RESERVAS.txt"
)

foreach ($item in $include) {
  $src = Join-Path $root $item
  if (Test-Path $src) {
    Copy-Item -LiteralPath $src -Destination $dest -Recurse -Force
  }
}

foreach ($dir in @("src", "public", "db", "scripts", "tests")) {
  Copy-Item -LiteralPath (Join-Path $root $dir) -Destination (Join-Path $dest $dir) -Recurse -Force
}

Remove-Item -LiteralPath (Join-Path $dest "scripts\preparar-paquete-publicacion.ps1") -Force -ErrorAction SilentlyContinue

Compress-Archive -LiteralPath (Join-Path $dest "*") -DestinationPath $zip -Force

Write-Host ""
Write-Host "Paquete publicable creado:"
Write-Host $dest
Write-Host ""
Write-Host "ZIP:"
Write-Host $zip
Write-Host ""
Write-Host "No incluye .env, backups ni generated."
