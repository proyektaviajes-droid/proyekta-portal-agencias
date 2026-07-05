$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $root ".env"

Write-Host ""
Write-Host "Configuracion inicial del portal PROYEKTA" -ForegroundColor Cyan
Write-Host "Necesitas haber creado antes el proyecto en Supabase y haber ejecutado db/001_schema.sql."
Write-Host ""

$supabaseUrl = Read-Host "SUPABASE_URL"
$serviceKey = Read-Host "SUPABASE_SERVICE_ROLE_KEY"
$adminEmail = Read-Host "Email del administrador [admin@proyektaviajes.es]"
if ([string]::IsNullOrWhiteSpace($adminEmail)) { $adminEmail = "admin@proyektaviajes.es" }

$securePassword = Read-Host "Contrasena del administrador (minimo 10 caracteres)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ($adminPassword.Length -lt 10) {
  throw "La contrasena debe tener al menos 10 caracteres."
}

$sessionSecretBytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($sessionSecretBytes)
} finally {
  $rng.Dispose()
}
$sessionSecret = [Convert]::ToBase64String($sessionSecretBytes)

$content = @"
PORT=4177
PUBLIC_BASE_URL=http://localhost:4177
SUPABASE_URL=$supabaseUrl
SUPABASE_SERVICE_ROLE_KEY=$serviceKey
SESSION_SECRET=$sessionSecret
BOOTSTRAP_ADMIN_EMAIL=$adminEmail
BOOTSTRAP_ADMIN_PASSWORD=$adminPassword
"@

Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Archivo .env creado en:" -ForegroundColor Green
Write-Host $envPath
Write-Host ""
Write-Host "Ahora ejecuta 02_crear_administrador.bat"
