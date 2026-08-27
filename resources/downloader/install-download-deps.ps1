$ErrorActionPreference = "Continue"
$logFile = "$env:TEMP\felo-downloader-deps.log"

function Write-Log {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $entry = "[$timestamp] $Message"
  Write-Host $entry
  Add-Content -Path $logFile -Value $entry -ErrorAction SilentlyContinue
}

Write-Log "=== Starting Felo Downloader Tools Installation (yt-dlp & FFmpeg) ==="

function Get-CommandPath {
  param([string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  return $null
}

function Find-WingetExe {
  $cmd = Get-CommandPath "winget.exe"
  if ($cmd -and (Test-Path $cmd)) { return $cmd }

  $userWinget = "$env:LOCALAPPDATA\Microsoft\WindowsApps\winget.exe"
  if (Test-Path $userWinget) { return $userWinget }

  $appInstaller = Get-ChildItem -Path "$env:ProgramFiles\WindowsApps" -Filter "winget.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($appInstaller) { return $appInstaller.FullName }

  return $null
}

$winget = Find-WingetExe

# 1. Check / Install yt-dlp
$ytdlp = Get-CommandPath "yt-dlp.exe"
if (-not $ytdlp) {
  Write-Log "yt-dlp not found in PATH."
  if ($winget) {
    Write-Log "Installing yt-dlp via winget..."
    & $winget install --id "yt-dlp.yt-dlp" --exact --silent --accept-package-agreements --accept-source-agreements
  } else {
    Write-Log "Downloading standalone yt-dlp.exe directly..."
    $ytdlpDir = "$env:LOCALAPPDATA\Programs\yt-dlp"
    New-Item -ItemType Directory -Force -Path $ytdlpDir | Out-Null
    $ytdlpDest = Join-Path $ytdlpDir "yt-dlp.exe"
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $ytdlpDest -UseBasicParsing
      Write-Log "Downloaded yt-dlp.exe successfully."
    } catch {
      Write-Log "Failed to download yt-dlp: $_"
    }
  }
} else {
  Write-Log "yt-dlp already installed at: $ytdlp"
}

# 2. Check / Install ffmpeg
$ffmpeg = Get-CommandPath "ffmpeg.exe"
if (-not $ffmpeg) {
  Write-Log "FFmpeg not found in PATH."
  if ($winget) {
    Write-Log "Installing FFmpeg via winget..."
    & $winget install --id "Gyan.FFmpeg" --exact --silent --accept-package-agreements --accept-source-agreements
  }
} else {
  Write-Log "FFmpeg already installed at: $ffmpeg"
}

Write-Log "=== Downloader Tools Installation Complete ==="
