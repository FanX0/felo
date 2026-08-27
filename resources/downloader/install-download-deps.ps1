param(
  [string]$PythonVersion = "3.12"
)

$ErrorActionPreference = "Stop"

function Get-CommandPath {
  param([string]$Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  return $null
}

function Get-PythonCommand {
  $pyLauncher = Get-CommandPath "py.exe"
  if ($pyLauncher) {
    return @($pyLauncher, "-$PythonVersion")
  }

  $python = Get-CommandPath "python.exe"
  if ($python) {
    return @($python)
  }

  return $null
}

function Invoke-Python {
  param([string[]]$Arguments)
  $pythonCommand = Get-PythonCommand
  if (-not $pythonCommand) {
    throw "Python was not found after installation."
  }

  $exe = $pythonCommand[0]
  $baseArgs = @()
  if ($pythonCommand.Length -gt 1) {
    $baseArgs = $pythonCommand[1..($pythonCommand.Length - 1)]
  }

  & $exe @baseArgs @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Python command failed: $exe $($baseArgs + $Arguments -join ' ')"
  }
}

if (-not (Get-PythonCommand)) {
  $winget = Get-CommandPath "winget.exe"
  if (-not $winget) {
    throw "Python is required, and winget was not found to install it automatically."
  }

  & $winget install --id "Python.Python.$PythonVersion" --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "Python installation failed."
  }

  # Refresh PATH so the current session can find the newly installed Python.
  # winget / MSI installers update the registry but the running process still
  # has the old PATH value.
  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath    = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path    = "$machinePath;$userPath"
}

Invoke-Python -Arguments @("-m", "pip", "install", "--upgrade", "pip")
Invoke-Python -Arguments @("-m", "pip", "install", "--upgrade", "streamrip", "yt-dlp")

if (-not (Get-CommandPath "ffmpeg.exe")) {
  $winget = Get-CommandPath "winget.exe"
  if ($winget) {
    & $winget install --id "Gyan.FFmpeg" --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "ffmpeg installation failed. YouTube downloads may not work until ffmpeg is installed."
    }
  } else {
    Write-Warning "winget was not found. YouTube downloads may not work until ffmpeg is installed."
  }
}
