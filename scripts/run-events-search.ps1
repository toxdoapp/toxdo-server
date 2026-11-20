# Corre la búsqueda de eventos con Claude Code en modo headless y escribe el resultado en un log.
# Pensado para ejecutarse desde el Programador de tareas de Windows cada 2 días.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$prompt = Get-Content -Raw -Path (Join-Path $here "events-prompt.txt")
$logDir = Join-Path $here "events-logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir ("events-{0:yyyy-MM-dd_HHmm}.log" -f (Get-Date))

try {
  $output = & claude -p $prompt 2>&1
  $output | Out-File -FilePath $logFile -Encoding utf8
} catch {
  "ERROR: $($_.Exception.Message)" | Out-File -FilePath $logFile -Encoding utf8
}
