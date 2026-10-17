# Stage 1: trigger GitHub sign-in via Git Credential Manager and stash the
# resulting credential locally (raw token stays on this machine only).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$credFile = Join-Path $root '.gh-cred.tmp'
$logFile = Join-Path $root '.gh-signin.log'

if (Test-Path $credFile) { Remove-Item $credFile -Force }

try {
  $out = "protocol=https`nhost=github.com`n`n" | git credential fill 2>&1
} catch {
  $out = @("error: $($_.Exception.Message)")
}

$user = ''
$hasSecret = $false
$lines = @()
foreach ($line in $out) {
  $s = [string]$line
  if ($s.StartsWith('username=')) {
    $user = $s.Substring(9)
    $lines += $s
  } elseif ($s.StartsWith('password=')) {
    $hasSecret = $true
    [System.IO.File]::WriteAllText($credFile, $s.Substring(9))
    $lines += 'password=<stored locally in .gh-cred.tmp>'
  } else {
    $lines += $s
  }
}
$status = if ($hasSecret) { "READY user=$user" } else { "FAILED" }
Set-Content -Path $logFile -Value @("status: $status") + $lines -Encoding UTF8