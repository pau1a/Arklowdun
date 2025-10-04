#!/usr/bin/env pwsh
[CmdletBinding()]
param(
    [switch]$Json,
    [switch]$Help
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Help.IsPresent) {
    Write-Output @'
Usage: scripts/guards/household_stats.ps1 [--Json]

Options:
  --Json   Emit JSON instead of the formatted table.
  --Help   Show this help message.
'@
    return
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Error 'npm is required to run the Tauri CLI.'
    exit 2
}

$repoRoot = (& git rev-parse --show-toplevel).Trim()
Set-Location $repoRoot

$args = @('run', '--silent', 'tauri', '--', 'diagnostics', 'household-stats')
if ($Json.IsPresent) {
    $args += '--json'
}

$process = Start-Process -FilePath 'npm' -ArgumentList $args -NoNewWindow -RedirectStandardOutput Pipe -RedirectStandardError Pipe -PassThru
$output = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()

if ($process.ExitCode -ne 0) {
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
        Write-Error ($stderr.Trim())
    }
    exit $process.ExitCode
}

if ([string]::IsNullOrWhiteSpace($output)) {
    Write-Error 'No household stats were returned.'
    exit 1
}

$output.TrimEnd() | Write-Output
