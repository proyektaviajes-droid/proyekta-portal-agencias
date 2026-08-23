$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$renderUrl = 'https://proyekta-portal-agencias.onrender.com/'
$publicUrl = 'https://agencias.proyektaviajes.es/'
$controlUrl = 'https://agencias.proyektaviajes.es/control.html'
$logDir = Join-Path $projectDir 'logs'
$logFile = Join-Path $logDir 'arranque-proyekta-control.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
}

function Test-Web([string]$Url, [int]$TimeoutSeconds = 5) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Method Get -TimeoutSec $TimeoutSeconds
    return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
  } catch {
    return $false
  }
}

function Test-ControlPublicado {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $controlUrl -Method Get -TimeoutSec 10
    return ($response.StatusCode -eq 200 -and $response.Content -match '<title>PROYEKTA CONTROL</title>')
  } catch {
    return $false
  }
}

function Wait-Web([string]$Url, [int]$MaxSeconds, [string]$Description) {
  $started = Get-Date
  $attempt = 0
  do {
    $attempt++
    if (Test-Web -Url $Url) {
      $elapsed = [int]((Get-Date) - $started).TotalSeconds
      Write-Log "$Description disponible (${elapsed}s)."
      return $true
    }
    $elapsed = [int]((Get-Date) - $started).TotalSeconds
    Write-Host ("Esperando a {0}... {1}/{2}s" -f $Description, $elapsed, $MaxSeconds)
    Start-Sleep -Seconds 3
  } while (((Get-Date) - $started).TotalSeconds -lt $MaxSeconds)
  return $false
}

Write-Log 'Inicio solicitado desde el Escritorio.'

Write-Log 'Despertando y comprobando el servicio de Render...'
try { Invoke-WebRequest -UseBasicParsing -Uri $publicUrl -Method Get -TimeoutSec 8 | Out-Null } catch {}
if (-not (Wait-Web -Url $renderUrl -MaxSeconds 180 -Description 'Render')) {
  throw 'Render no ha respondido en 3 minutos. Comprueba Internet o el estado del servicio y vuelve a intentarlo.'
}

if (-not (Test-ControlPublicado)) {
  throw 'La version central de PROYEKTA CONTROL todavia no esta publicada. Se ha detenido la apertura para no mostrar por error la portada de agencias.'
}

Write-Log 'Base central preparada. Abriendo PROYEKTA CONTROL de proveedores y costes.'
Start-Process $controlUrl
