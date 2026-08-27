param(
  [string]$PythonVersion = "3.12"
)

$ErrorActionPreference = "Continue"
$logFile = "$env:TEMP\felo-downloader-deps.log"

function Write-Log {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $entry = "[$timestamp] $Message"
  Write-Host $entry
  Add-Content -Path $logFile -Value $entry -ErrorAction SilentlyContinue
}

Write-Log "=== Starting Felo Downloader Dependencies Installation ==="

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

$script:PythonExe = $null
$script:PythonPrefixArgs = @()

function Test-PythonWorking {
  param([string]$ExePath, [string[]]$Prefix = @())
  if (-not $ExePath -or -not (Test-Path $ExePath)) { return $false }
  try {
    $item = Get-Item $ExePath -ErrorAction SilentlyContinue
    if ($item.Length -eq 0) { return $false } # WindowsApps 0-byte shim

    $testOutput = & $ExePath @Prefix "--version" 2>&1
    if ($LASTEXITCODE -eq 0 -and "$testOutput" -match "Python\s+3\.") {
      return $true
    }
  } catch {
    return $false
  }
  return $false
}

function Find-PythonExe {
  # 1. Check py launcher
  $py = Get-CommandPath "py.exe"
  if ($py -and (Test-PythonWorking $py @("-$PythonVersion"))) {
    $script:PythonExe = $py
    $script:PythonPrefixArgs = @("-$PythonVersion")
    return $true
  }

  $pyLauncher = "$env:LOCALAPPDATA\Programs\Python\Launcher\py.exe"
  if ((Test-Path $pyLauncher) -and (Test-PythonWorking $pyLauncher @("-$PythonVersion"))) {
    $script:PythonExe = $pyLauncher
    $script:PythonPrefixArgs = @("-$PythonVersion")
    return $true
  }

  # 2. Check python.exe in PATH
  $python = Get-CommandPath "python.exe"
  if ($python -and (Test-PythonWorking $python)) {
    $script:PythonExe = $python
    $script:PythonPrefixArgs = @()
    return $true
  }

  # 3. Check standard Python installation directories
  $searchDirs = @(
    "$env:LOCALAPPDATA\Programs\Python",
    "$env:ProgramFiles\Python",
    "$env:ProgramFiles\Python313",
    "$env:ProgramFiles\Python312",
    "$env:ProgramFiles\Python311",
    "$env:ProgramFiles\Python310",
    "C:\Python313",
    "C:\Python312",
    "C:\Python311",
    "C:\Python310"
  )

  foreach ($dir in $searchDirs) {
    if (Test-Path $dir) {
      $pyCandidate = Join-Path $dir "python.exe"
      if (Test-PythonWorking $pyCandidate) {
        $script:PythonExe = $pyCandidate
        $script:PythonPrefixArgs = @()
        return $true
      }

      $subCandidates = Get-ChildItem -Path $dir -Directory -Filter "Python3*" -ErrorAction SilentlyContinue
      foreach ($sub in $subCandidates) {
        $subPy = Join-Path $sub.FullName "python.exe"
        if (Test-PythonWorking $subPy) {
          $script:PythonExe = $subPy
          $script:PythonPrefixArgs = @()
          return $true
        }
      }
    }
  }

  return $false
}

# Ensure Python is installed
$found = Find-PythonExe
if (-not $found) {
  Write-Log "Python 3.10+ not found. Attempting automatic installation..."
  $winget = Find-WingetExe

  if ($winget) {
    Write-Log "Installing Python via winget ($winget)..."
    & $winget install --id "Python.Python.$PythonVersion" --exact --silent --accept-package-agreements --accept-source-agreements
  }

  $found = Find-PythonExe

  # If winget failed or was unavailable, download official Python installer directly
  if (-not $found) {
    Write-Log "Winget unavailable or failed. Downloading official Python installer from python.org..."
    $installerUrl = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe"
    $installerPath = "$env:TEMP\python-3.12.8-amd64.exe"
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -Uri $installerUrl -OutFile $installerPath -UseBasicParsing
      Write-Log "Running silent Python installation..."
      Start-Process -FilePath $installerPath -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1" -Wait
      Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    } catch {
      Write-Log "Direct Python download failed: $_"
    }
  }

  # Refresh environment PATH from registry
  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath;$env:LOCALAPPDATA\Programs\Python\Python312;$env:LOCALAPPDATA\Programs\Python\Python312\Scripts"

  $found = Find-PythonExe
}

if (-not $found -or -not $script:PythonExe) {
  Write-Log "ERROR: Python could not be located or installed."
  throw "Python was not found and could not be installed automatically. Please install Python 3.10+ manually from python.org."
}

Write-Log "Using Python: $script:PythonExe $($script:PythonPrefixArgs -join ' ')"

function Run-Py {
  param(
    [Parameter(Mandatory = $true, Position = 0, ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )
  $allArgs = @($script:PythonPrefixArgs) + @($Arguments)
  Write-Log "Running: $script:PythonExe $($allArgs -join ' ')"
  & "$script:PythonExe" $allArgs
}

# Upgrade pip and install streamrip & yt-dlp
Write-Log "Upgrading pip..."
Run-Py -Arguments @("-m", "pip", "install", "--upgrade", "pip")

Write-Log "Installing streamrip and yt-dlp..."
Run-Py -Arguments @("-m", "pip", "install", "--upgrade", "streamrip", "yt-dlp")

# Install ffmpeg if missing
$ffmpeg = Get-CommandPath "ffmpeg.exe"
if (-not $ffmpeg) {
  $winget = Find-WingetExe
  if ($winget) {
    Write-Log "Installing ffmpeg via winget..."
    & $winget install --id "Gyan.FFmpeg" --exact --silent --accept-package-agreements --accept-source-agreements
  }
}

Write-Log "=== Downloader Dependencies Installation Complete ==="

