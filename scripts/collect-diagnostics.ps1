#!/usr/bin/env pwsh
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $env:ARK_SILENCE_TODO) {
@'
===============================================================================
 ⚠️  DIAGNOSTICS TODO: Unix collector depends on python3 (temporary).
     Replace with a bundled helper (ark-diag) before any paid/public release.
     Tracking: PR-Diag-01..04.
===============================================================================
'@ | Write-Warning
}

$ScriptVersion = '1.0.0'
$DefaultBundleId = 'com.paula.arklowdun'
$MaxFileMbDefault = 10

function Show-Usage {
    @'
Usage: scripts/collect-diagnostics.ps1 [options]

Options:
  --out DIR          Output directory for the diagnostics zip (default: Desktop)
  --raw              Include raw, unredacted copies (requires confirmation)
  --include-db       Include hash metadata for the SQLite database
  --data-dir DIR     Override app data directory
  --logs-dir DIR     Override logs directory
  --bundle-id ID     Override bundle identifier
  --yes              Non-interactive mode; assume consent for --raw
  --help             Show this help message
'@
}

function Resolve-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )
    $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
    if ($resolved) {
        return $resolved.Path
    }
    return [System.IO.Path]::GetFullPath([System.IO.Path]::Combine((Get-Location).Path, $Path))
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        [System.IO.Directory]::CreateDirectory($Path) | Out-Null
    }
}

function Compute-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-IsoTimestamp {
    param([datetime]$DateTime)
    return $DateTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

function Get-AppVersion {
    $pathJson = Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json'
    $pathJson5 = Join-Path $PSScriptRoot '../src-tauri/tauri.conf.json5'
    $target = $null
    if (Test-Path -LiteralPath $pathJson) { $target = $pathJson }
    elseif (Test-Path -LiteralPath $pathJson5) { $target = $pathJson5 }
    if (-not $target) { return 'unknown' }
    $content = Get-Content -LiteralPath $target -Raw
    $match = [regex]::Match($content, '"version"\s*:\s*"([^"]+)"')
    if ($match.Success) { return $match.Groups[1].Value }
    return 'unknown'
}

function Get-OsVersion {
    if ($IsMacOS) {
        try { return (sw_vers -productVersion) } catch { return 'macOS' }
    } elseif ($IsLinux) {
        $osRelease = '/etc/os-release'
        if (Test-Path -LiteralPath $osRelease) {
            $line = Get-Content -LiteralPath $osRelease | Where-Object { $_ -like 'PRETTY_NAME=*' } | Select-Object -First 1
            if ($line) { return $line.Split('=')[1].Trim('"') }
        }
        return 'linux'
    } else {
        return [System.Environment]::OSVersion.VersionString
    }
}

$maxFileMb = if ($env:ARK_MAX_FILE_MB) { [int]$env:ARK_MAX_FILE_MB } else { $MaxFileMbDefault }
if ($maxFileMb -le 0) {
    throw "ARK_MAX_FILE_MB must be a positive integer"
}
$maxFileBytes = $maxFileMb * 1024 * 1024

$outDir = $null
$rawRequested = $false
$includeDb = $false
$dataDir = $null
$logsDir = $null
$bundleId = $DefaultBundleId
$yesMode = $false

for ($i = 0; $i -lt $args.Length; $i++) {
    switch ($args[$i]) {
        '--out' {
            if ($i + 1 -ge $args.Length) { throw '--out requires a value' }
            $i++
            $outDir = $args[$i]
        }
        '--raw' { $rawRequested = $true }
        '--include-db' { $includeDb = $true }
        '--data-dir' {
            if ($i + 1 -ge $args.Length) { throw '--data-dir requires a value' }
            $i++
            $dataDir = $args[$i]
        }
        '--logs-dir' {
            if ($i + 1 -ge $args.Length) { throw '--logs-dir requires a value' }
            $i++
            $logsDir = $args[$i]
        }
        '--bundle-id' {
            if ($i + 1 -ge $args.Length) { throw '--bundle-id requires a value' }
            $i++
            $bundleId = $args[$i]
        }
        '--yes' { $yesMode = $true }
        '--help' { Show-Usage; exit 0 }
        default { throw "Unknown argument: $($args[$i])" }
    }
}

$usedDefaultOut = $false
if (-not $outDir) {
    if ($IsWindows) {
        $outDir = [Environment]::GetFolderPath('Desktop')
    } else {
        $outDir = [Environment]::GetFolderPath('Desktop')
        if (-not $outDir) { $outDir = "$HOME/Desktop" }
    }
    $usedDefaultOut = $true
}

if (-not $dataDir) {
    if ($IsWindows) {
        $dataDir = [System.IO.Path]::Combine($env:APPDATA, 'Arklowdun')
    } elseif ($IsMacOS) {
        $dataDir = Join-Path $HOME "Library/Application Support/$bundleId"
    } else {
        $xdgData = if ($env:XDG_DATA_HOME) { $env:XDG_DATA_HOME } else { Join-Path $HOME '.local/share' }
        $dataDir = Join-Path $xdgData 'Arklowdun'
    }
}

if (-not $logsDir) {
    if ($IsWindows) {
        $logsDir = [System.IO.Path]::Combine($env:LOCALAPPDATA, 'Arklowdun', 'Logs')
    } elseif ($IsMacOS) {
        $logsDir = Join-Path $HOME 'Library/Logs/Arklowdun'
    } else {
        $xdgState = if ($env:XDG_STATE_HOME) { $env:XDG_STATE_HOME } else { Join-Path $HOME '.local/state' }
        $logsDir = Join-Path $xdgState 'Arklowdun/logs'
    }
}

$outDir = Resolve-AbsolutePath $outDir
if (-not (Test-Path -LiteralPath $outDir)) {
    if ($usedDefaultOut) {
        $outDir = (Get-Location).Path
        Write-Warning "Desktop not found; using $outDir"
    } else {
        Ensure-Directory $outDir
    }
}
$outDir = Resolve-AbsolutePath $outDir
$dataDir = Resolve-AbsolutePath $dataDir
$logsDir = Resolve-AbsolutePath $logsDir
Ensure-Directory $outDir

$crashRoot = $null
if ($IsMacOS) {
    $crashRoot = Resolve-AbsolutePath (Join-Path $HOME 'Library/Logs/DiagnosticReports')
}

$rawMode = $false
if ($rawRequested) {
    if (-not $yesMode) {
        $confirmation = Read-Host 'WARNING: --raw includes unredacted files and may expose PII. Continue? (y/N)'
        if ($confirmation -match '^(y|yes)$') {
            $rawMode = $true
        } else {
            $rawMode = $false
            Write-Warning 'Raw data collection cancelled by user prompt; continuing with redacted copies only.'
        }
    } else {
        $rawMode = $true
    }
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("arklowdun-" + [System.Guid]::NewGuid().ToString('N'))
Ensure-Directory $tempDir
$bundleRoot = Join-Path $tempDir 'diagnostics'
$collectedRoot = Join-Path $bundleRoot 'collected'
$rawRoot = Join-Path $bundleRoot 'raw'
$dbRoot = Join-Path $bundleRoot 'db'
Ensure-Directory $bundleRoot
Ensure-Directory $collectedRoot

$manifest = New-Object System.Collections.Generic.List[object]
$warnings = New-Object System.Collections.Generic.List[string]
$exitCode = 0

function Add-ManifestEntry {
    param(
        [string]$Path,
        [string]$Category,
        [bool]$Included,
        [string]$Reason,
        [Nullable[long]]$Size,
        [Nullable[datetime]]$Mtime,
        [Nullable[bool]]$Redacted,
        [string]$Sha,
        [string]$ShaRaw,
        [Nullable[int]]$LimitMb
    )
    $entry = [ordered]@{
        path = $Path
        category = $Category
        included = $Included
        size_bytes = if ($Size) { [long]$Size } else { $null }
        mtime_iso = if ($Mtime) { Get-IsoTimestamp $Mtime } else { $null }
    }
    if ($Reason) { $entry['reason'] = $Reason }
    if ($null -ne $Redacted) { $entry['redacted'] = [bool]$Redacted }
    if ($Sha) { $entry['sha256'] = $Sha }
    if ($ShaRaw) { $entry['sha256_raw'] = $ShaRaw }
    if ($null -ne $LimitMb) { $entry['limit_mb'] = [int]$LimitMb }
    $manifest.Add([PSCustomObject]$entry)
}

function Add-Warning {
    param([string]$Message)
    $warnings.Add($Message) | Out-Null
}

function Get-RedactedText {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [string]$DataRoot,
        [string]$LogsRoot
    )
    $text = Get-Content -LiteralPath $SourcePath -Raw -ErrorAction Stop
    if ($HOME) {
        $text = $text -replace [regex]::Escape($HOME), '<home>'
    }
    if ($IsWindows) {
        $text = [regex]::Replace($text, '(?i)[A-Z]:\\Users\\[^\\/:]+', '<home>')
    }
    $patterns = @(
        @{ Pattern = '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'; Replacement = '<redacted:email>' },
        @{ Pattern = '\b(?:\d{1,3}\.){3}\d{1,3}\b'; Replacement = '<redacted:ip>' },
        @{ Pattern = '\b(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}\b'; Replacement = '<redacted:ip>' },
        @{ Pattern = '\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b'; Replacement = '<redacted:mac>' }
    )
    foreach ($rule in $patterns) {
        $text = [regex]::Replace($text, $rule.Pattern, $rule.Replacement)
    }
    $text = [regex]::Replace($text, '(?i)("(?:api_key|token|password|secret)"\s*:\s*)"[^"]*"', '$1"<redacted:secret>"')
    $text = [regex]::Replace($text, "(?i)('(?:api_key|token|password|secret)'\s*:\s*)'[^']*'", "$1'<redacted:secret>'")
    $text = [regex]::Replace($text, '(?i)(\b(?:api_key|token|password|secret)\b\s*[=:]\s*)([^\s"\']+)', '$1<redacted:secret>')

    $text = [regex]::Replace($text, '\b[0-9A-Fa-f]{16,}\b', {
        param($match)
        $prefix = $match.Input.Substring([Math]::Max(0, $match.Index - 10), [Math]::Min(10, $match.Index))
        if ($prefix -match 'CrashID') { return $match.Value }
        return '<redacted:uuid>'
    })

    $unixPattern = [regex]'/(?!home/)(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+'
    $text = $unixPattern.Replace($text, {
        param($match)
        $token = $match.Value
        if ($token.Contains('://')) { return $token }
        $contextLength = [Math]::Min(10, $match.Index)
        $contextStart = [Math]::Max(0, $match.Index - 10)
        $context = if ($contextLength -gt 0) { $match.Input.Substring($contextStart, $contextLength) } else { '' }
        if ($context.Contains('://')) { return $token }
        $prefix = if ($match.Index -gt 0) { $match.Input.Substring(0, $match.Index) } else { '' }
        $schemeIndex = $prefix.LastIndexOf('://')
        if ($schemeIndex -ge 0) {
            $tail = $prefix.Substring($schemeIndex)
            if ($tail -notmatch '\s') { return $token }
        }
        if ($DataRoot -and $token.StartsWith($DataRoot, [StringComparison]::OrdinalIgnoreCase)) {
            return '<app-data>' + $token.Substring($DataRoot.Length)
        }
        if ($LogsRoot -and $token.StartsWith($LogsRoot, [StringComparison]::OrdinalIgnoreCase)) {
            return '<app-logs>' + $token.Substring($LogsRoot.Length)
        }
        if ($token.StartsWith('<home>/')) { return $token }
        return '<path>'
    })

    if ($IsWindows) {
        $winPattern = [regex]'(?i)[A-Z]:\\[^\s"\']+'
        $text = $winPattern.Replace($text, {
            param($match)
            $token = $match.Value
            if ($token.Contains('://')) { return $token }
            $contextLength = [Math]::Min(10, $match.Index)
            $contextStart = [Math]::Max(0, $match.Index - 10)
            $context = if ($contextLength -gt 0) { $match.Input.Substring($contextStart, $contextLength) } else { '' }
            if ($context.Contains('://')) { return $token }
            $prefix = if ($match.Index -gt 0) { $match.Input.Substring(0, $match.Index) } else { '' }
            $schemeIndex = $prefix.LastIndexOf('://')
            if ($schemeIndex -ge 0) {
                $tail = $prefix.Substring($schemeIndex)
                if ($tail -notmatch '\s') { return $token }
            }
            $norm = $token.Replace('\\', '/').ToLowerInvariant()
            if ($DataRoot) {
                $dataNorm = $DataRoot.Replace('\\', '/').ToLowerInvariant()
                if ($norm.StartsWith($dataNorm)) {
                    return '<app-data>' + $token.Substring($DataRoot.Length)
                }
            }
            if ($LogsRoot) {
                $logsNorm = $LogsRoot.Replace('\\', '/').ToLowerInvariant()
                if ($norm.StartsWith($logsNorm)) {
                    return '<app-logs>' + $token.Substring($LogsRoot.Length)
                }
            }
            if ($token.ToLowerInvariant().StartsWith('<home>')) { return $token }
            return '<path>'
        })
    }

    return $text
}

function Process-SourceFile {
    param(
        [string]$Category,
        [string]$SourcePath,
        [string]$BasePath,
        [string]$Subdir,
        [string]$OverrideName
    )
    if (-not (Test-Path -LiteralPath $SourcePath)) {
        Add-ManifestEntry $SourcePath $Category $false 'not_found' $null $null $false $null $null $null
        return
    }
    $info = Get-Item -LiteralPath $SourcePath
    if ($info.Length -gt $maxFileBytes) {
        Add-ManifestEntry $SourcePath $Category $false "exceeds ${maxFileMb}MB limit" $info.Length $info.LastWriteTimeUtc $false $null $null $maxFileMb
        return
    }
    $relative = if ($BasePath -and $SourcePath.StartsWith($BasePath, [StringComparison]::OrdinalIgnoreCase)) {
        $SourcePath.Substring($BasePath.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    } else {
        [System.IO.Path]::GetFileName($SourcePath)
    }
    if ($OverrideName) { $relative = $OverrideName }
    $dest = Join-Path (Join-Path $collectedRoot $Subdir) $relative
    Ensure-Directory (Split-Path -Parent $dest)
    try {
        $redacted = Get-RedactedText -SourcePath $SourcePath -DataRoot $dataDir -LogsRoot $logsDir
        [System.IO.File]::WriteAllText($dest, $redacted) | Out-Null
    } catch {
        Add-Warning "Failed to redact $SourcePath: $($_.Exception.Message)"
        Add-ManifestEntry $SourcePath $Category $false 'redaction_failed' $info.Length $info.LastWriteTimeUtc $false $null $null $null
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
        return
    }
    $sha = Compute-Sha256 $dest
    $shaRaw = $null
    if ($rawMode) {
        $rawDest = Join-Path (Join-Path $rawRoot $Subdir) $relative
        Ensure-Directory (Split-Path -Parent $rawDest)
        try {
            Copy-Item -LiteralPath $SourcePath -Destination $rawDest -Force
            $shaRaw = Compute-Sha256 $rawDest
        } catch {
            Add-Warning "Failed to copy raw file $SourcePath: $($_.Exception.Message)"
        }
    }
    Add-ManifestEntry $SourcePath $Category $true $null $info.Length $info.LastWriteTimeUtc $true $sha $shaRaw $null
}

function Collect-Logs {
    if (-not (Test-Path -LiteralPath $logsDir)) { return }
    Get-ChildItem -LiteralPath $logsDir -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $name = $_.Name
        if ($name -like '*.log' -or $name -like '*.jsonl' -or $name -like '*.ndjson' -or $name -like '*.log.*' -or $name -like '*.jsonl.*' -or $name -like '*.ndjson.*') {
            Process-SourceFile 'log' $_.FullName $logsDir 'logs' $null
        }
    }
}

function Collect-Config {
    if (-not (Test-Path -LiteralPath $dataDir)) { return }
    Get-ChildItem -LiteralPath $dataDir -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $name = $_.Name
        if ($name -like '*.json' -or $name -like '*.toml' -or $name -like '*.ini') {
            Process-SourceFile 'config' $_.FullName $dataDir 'config' $null
        }
    }
}

function Collect-Crash {
    if (-not $crashRoot -or -not (Test-Path -LiteralPath $crashRoot)) {
        $stubPath = Join-Path (Join-Path $collectedRoot 'crash') 'latest.crash.txt'
        Ensure-Directory (Split-Path -Parent $stubPath)
        "No crash reports matching '$bundleId' were found on this platform." | Set-Content -LiteralPath $stubPath -Encoding UTF8
        $origin = if ($crashRoot) { $crashRoot } else { '(none)' }
        Add-ManifestEntry $origin 'crash' $false 'not_found' $null $null $false $null $null $null
        return
    }
    $latest = Get-ChildItem -LiteralPath $crashRoot -Filter "*${bundleId}*.crash" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $latest) {
        $latest = Get-ChildItem -LiteralPath $crashRoot -Filter "*${bundleId}*.ips" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    }
    if (-not $latest) {
        $latest = Get-ChildItem -LiteralPath $crashRoot -Filter '*Arklowdun*.crash' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    }
    if (-not $latest) {
        $latest = Get-ChildItem -LiteralPath $crashRoot -Filter '*Arklowdun*.ips' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    }
    if ($latest) {
        Process-SourceFile 'crash' $latest.FullName $latest.Directory.FullName 'crash' 'latest.crash.txt'
    } else {
        $stubPath = Join-Path (Join-Path $collectedRoot 'crash') 'latest.crash.txt'
        Ensure-Directory (Split-Path -Parent $stubPath)
        "No crash reports matching '$bundleId' were found on this system. Checked directory: $crashRoot" | Set-Content -LiteralPath $stubPath -Encoding UTF8
        Add-ManifestEntry $crashRoot 'crash' $false 'not_found' $null $null $false $null $null $null
    }
}

try {
    Collect-Logs
    Collect-Config
    Collect-Crash

    if ($includeDb) {
        Ensure-Directory $dbRoot
        $dbPath = if ($env:ARK_DB_PATH) { $env:ARK_DB_PATH } else { Join-Path $dataDir 'app.db' }
        if (Test-Path -LiteralPath $dbPath) {
            $dbInfo = Get-Item -LiteralPath $dbPath
            $dbSha = Compute-Sha256 $dbPath
            $meta = [ordered]@{
                path = $dbPath
                size_bytes = [long]$dbInfo.Length
                mtime_iso = Get-IsoTimestamp $dbInfo.LastWriteTimeUtc
            }
            $meta | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $dbRoot 'db.meta.json') -Encoding UTF8
            "$dbSha  $dbPath" | Set-Content -LiteralPath (Join-Path $dbRoot 'db.sha256') -Encoding UTF8
            Add-ManifestEntry $dbPath 'db' $false 'hash_only' $dbInfo.Length $dbInfo.LastWriteTimeUtc $false $null $dbSha $null
        } else {
            Add-Warning "Database file not found at $dbPath"
            Add-ManifestEntry $dbPath 'db' $false 'not_found' $null $null $false $null $null $null
        }
    }

    if ($rawMode) { Ensure-Directory $rawRoot }

    $manifestPath = Join-Path $bundleRoot 'manifest.json'
    Ensure-Directory (Split-Path -Parent $manifestPath)
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    $systemInfo = [ordered]@{
        bundle_id = $bundleId
        app_version = Get-AppVersion
        platform = if ($IsWindows) { 'windows' } elseif ($IsMacOS) { 'macos' } elseif ($IsLinux) { 'linux' } else { 'unknown' }
        os_version = Get-OsVersion
        arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLower()
        timestamp_iso = Get-IsoTimestamp (Get-Date)
        data_dir = $dataDir
        logs_dir = $logsDir
        script_version = $ScriptVersion
    }
    $systemInfo | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $bundleRoot 'system.json') -Encoding UTF8

    $readmePath = Join-Path $bundleRoot 'README.txt'
    $readme = @()
    if ($rawMode) {
        $readme += '*** WARNING: RAW FILES INCLUDED ***'
        $readme += 'These diagnostics include raw, unredacted copies of application files.'
        $readme += 'Please review before sharing.'
        $readme += ''
    }
    $readme += 'Arklowdun Diagnostics Bundle'
    $readme += '============================'
    $readme += ''
    $readme += "Generated by scripts/collect-diagnostics.ps1 (version $ScriptVersion)."
    $readme += 'Contents include redacted copies of logs, configuration, and crash reports (if present).'
    $readme += 'A manifest (manifest.json) lists every file considered along with metadata and checksums.'
    $readme += 'Checksums for collected files are recorded in checksums.txt.'
    $readme += ''
    $readme += 'Flags:'
    $readme += '  --raw        Include unredacted copies (prompted unless --yes)'
    $readme += '  --include-db Include database hash metadata only'
    $readme += '  --out DIR    Choose destination directory'
    $readme += ''
    $readme += 'Review manifest.json to understand which files were included or skipped.'
    $readme += 'Redaction replaces emails, IP addresses, MAC addresses, home directory paths, absolute paths outside app scopes, long hex tokens, and secret-like keys.'
    $readme += 'Relative paths within the app data and logs directories are preserved.'
    if ($includeDb) {
        $readme += ''
        $readme += 'Database metadata is available under db/. The SQLite file itself is not included.'
    }
    if (-not $crashRoot) {
        $readme += ''
        $readme += 'Crash report stubs are included because automatic discovery is not configured on this platform.'
    }
    $readme += ''
    $readme += 'To inspect raw files (when included), see the raw/ directory.'
    $readme += 'Share this archive with support by attaching the resulting zip file to your email.'
    $readme | Set-Content -LiteralPath $readmePath -Encoding UTF8

    $checksumsPath = Join-Path $bundleRoot 'checksums.txt'
    if (Test-Path -LiteralPath $checksumsPath) { Remove-Item -LiteralPath $checksumsPath -Force }
    function Add-Checksums {
        param([string]$Target)
        if (Test-Path -LiteralPath $Target) {
            Get-ChildItem -LiteralPath $Target -File -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName | ForEach-Object {
                $relative = $_.FullName.Substring($bundleRoot.Length + 1)
                $hash = Compute-Sha256 $_.FullName
                Add-Content -LiteralPath $checksumsPath -Value "$hash  $relative" -Encoding UTF8
            }
        }
    }
    Add-Checksums $collectedRoot
    Add-Checksums $rawRoot
    Add-Checksums $dbRoot

    $manifestHash = Compute-Sha256 $manifestPath
    Add-Content -LiteralPath $checksumsPath -Value "$manifestHash  manifest.json" -Encoding UTF8
    $shortHash = $manifestHash.Substring(0,8)
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $zipName = "diagnostics-$timestamp-$shortHash.zip"
    $zipPath = Join-Path $outDir $zipName
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -LiteralPath $bundleRoot -DestinationPath $zipPath -Force

    foreach ($warning in $warnings) {
        Write-Warning $warning
    }
    Write-Output $zipPath
    if ($warnings.Count -gt 0) {
        $exitCode = 1
    }
}
finally {
    if (Test-Path -LiteralPath $tempDir) {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit $exitCode
