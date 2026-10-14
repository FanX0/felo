param(
  [string]$AssetRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$discordApplicationId = '1540785679859056640'
$musicPresenceRoot = Join-Path $env:APPDATA 'Music Presence'
$musicPresenceAssets = Join-Path $musicPresenceRoot 'assets'
$settingsPath = Join-Path $musicPresenceRoot 'settings.json'
$playersPath = Join-Path $musicPresenceAssets 'players.json'
$playerTemplatePath = Join-Path $AssetRoot 'felo-player.json'

function Ensure-Directory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Set-Property($Object, [string]$Name, $Value) {
  $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Ensure-ObjectProperty($Object, [string]$Name) {
  if (-not $Object.PSObject.Properties[$Name] -or $null -eq $Object.$Name) {
    Set-Property $Object $Name ([pscustomobject]@{})
  }
  return $Object.$Name
}

function Load-JsonObject([string]$Path, $Fallback) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return $Fallback
  }

  $content = Get-Content -LiteralPath $Path -Raw
  if ([string]::IsNullOrWhiteSpace($content)) {
    return $Fallback
  }

  try {
    # Strip UTF-8 BOM if present
    $clean = $content.TrimStart([char]0xFEFF)
    return $clean | ConvertFrom-Json
  } catch {
    return $Fallback
  }
}

function Save-JsonObject([string]$Path, $Object, [int]$Depth = 40) {
  if (Test-Path -LiteralPath $Path) {
    Set-ItemProperty -LiteralPath $Path -Name IsReadOnly -Value $false -ErrorAction SilentlyContinue
    try { (Get-Item -LiteralPath $Path).IsReadOnly = $false } catch {}
  }
  $json = $Object | ConvertTo-Json -Depth $Depth
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $json, $utf8NoBom)
}

function Find-MusicPresenceExecutable() {
  $candidates = @(
    'E:\apps\musicpresencediscord\latest\Music Presence.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Music Presence\Music Presence.exe'),
    (Join-Path $env:ProgramFiles 'Music Presence\Music Presence.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Music Presence\Music Presence.exe')
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

Ensure-Directory $musicPresenceRoot
Ensure-Directory $musicPresenceAssets

$musicPresenceProcess = Get-Process 'Music Presence' -ErrorAction SilentlyContinue | Select-Object -First 1
$musicPresencePath = if ($musicPresenceProcess) { $musicPresenceProcess.Path } else { Find-MusicPresenceExecutable }

if ($musicPresenceProcess) {
  $musicPresenceProcess | Stop-Process -Force
  Start-Sleep -Milliseconds 800
}

# 1. Configure settings.json
$settings = Load-JsonObject $settingsPath ([pscustomobject]@{
  version = 1
  enabled = $true
  presence = [pscustomobject]@{}
  player_overrides = [pscustomobject]@{ well_known = [pscustomobject]@{} }
  players = [pscustomobject]@{ well_known = [pscustomobject]@{}; unknown = @() }
})

$settings.enabled = $true

$presence = Ensure-ObjectProperty $settings 'presence'
Set-Property $presence 'show_player_logo' $true
Set-Property $presence 'show_media_playing_icon' $false
Set-Property $presence 'show_media_paused_icon' $false
Set-Property $presence 'no_cover_placeholder' 'player_logo'
Set-Property $presence 'display_type' 'title_line'
Set-Property $presence 'profile_display_type' 'player_name'
Set-Property $presence 'activity_type' 'listening'
Set-Property $presence 'custom_discord_application_id' ([pscustomobject]@{
  valid = $true
  value = $discordApplicationId
})

$playerOverrides = Ensure-ObjectProperty $settings 'player_overrides'
$wellKnownOverrides = Ensure-ObjectProperty $playerOverrides 'well_known'
Set-Property $wellKnownOverrides 'felo' ([pscustomobject]@{
  show_media_playing_icon = $false
  show_media_paused_icon = $false
  show_player_logo = $true
  no_cover_placeholder = 'player_logo'
  display_type = 'title_line'
  profile_display_type = 'player_name'
  activity_type = 'listening'
  custom_discord_application_id = [pscustomobject]@{
    valid = $true
    value = $discordApplicationId
  }
})

$playersSettings = Ensure-ObjectProperty $settings 'players'
$wellKnownPlayers = Ensure-ObjectProperty $playersSettings 'well_known'
Set-Property $wellKnownPlayers 'felo' ([pscustomobject]@{
  enabled = $true
  user_modified = $true
})

# Remove felo / com.felo.app from unknown so it gets identified as well-known player
if ($playersSettings.PSObject.Properties['unknown'] -and $null -ne $playersSettings.unknown) {
  $cleanedUnknown = @($playersSettings.unknown | Where-Object {
    $id = $_.identifier.id
    -not ($id -match 'felo' -or $id -eq 'com.fanxmusic.app')
  })
  Set-Property $playersSettings 'unknown' $cleanedUnknown
} else {
  Set-Property $playersSettings 'unknown' @()
}

Save-JsonObject $settingsPath $settings

# 2. Copy player icon assets
$iconFiles = @{
  'felo-logo.png' = 'felo-logo.png'
  'felo-discord-large.png' = 'felo-logo.png'
  'felo-discord-small.png' = 'felo-logo.png'
  'felo.ico' = 'felo.ico'
}

foreach ($targetName in $iconFiles.Keys) {
  $sourcePath = Join-Path $AssetRoot $iconFiles[$targetName]
  $targetPath = Join-Path $musicPresenceAssets $targetName
  if (Test-Path -LiteralPath $sourcePath) {
    if (Test-Path -LiteralPath $targetPath) {
      Set-ItemProperty -LiteralPath $targetPath -Name IsReadOnly -Value $false -ErrorAction SilentlyContinue
    }
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    Set-ItemProperty -LiteralPath $targetPath -Name IsReadOnly -Value $true -ErrorAction SilentlyContinue
  }
}

# 3. Configure players.json
if (Test-Path -LiteralPath $playerTemplatePath) {
  if (Test-Path -LiteralPath $playersPath) {
    Set-ItemProperty -LiteralPath $playersPath -Name IsReadOnly -Value $false -ErrorAction SilentlyContinue
    try { (Get-Item -LiteralPath $playersPath).IsReadOnly = $false } catch {}
  }

  $basePlayers = $null
  if (Test-Path -LiteralPath $playersPath) {
    $basePlayers = Load-JsonObject $playersPath $null
  }

  # If players.json is missing, wiped, or has only felo (<= 1 player), recover from larger backup
  if (-not $basePlayers -or -not $basePlayers.players -or $basePlayers.players.Count -le 1) {
    $backup = Get-ChildItem -LiteralPath $musicPresenceAssets -Filter "players.json.*" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'backup|bak|local' } |
      Sort-Object Length -Descending |
      Select-Object -First 1
    if ($backup) {
      $candidate = Load-JsonObject $backup.FullName $null
      if ($candidate -and $candidate.players -and $candidate.players.Count -gt 1) {
        $basePlayers = $candidate
      }
    }
  }

  $players = if ($basePlayers -and $basePlayers.players) {
    $basePlayers
  } else {
    [pscustomobject]@{
      '$schema' = 'https://live.musicpresence.app/v3/schemas/players.schema.json'
      version = 3
      latest = $true
      subset = 'win'
      players = @()
      icons = [pscustomobject]@{}
    }
  }

  $feloPlayer = Get-Content -LiteralPath $playerTemplatePath -Raw | ConvertFrom-Json
  $remainingPlayers = @($players.players | Where-Object { $_.id -ne 'felo' })
  Set-Property $players 'players' ($remainingPlayers + $feloPlayer)

  $icons = Ensure-ObjectProperty $players 'icons'
  Set-Property $icons 'felo' @(
    [pscustomobject]@{ label = 'logo-128'; type = 'png'; url = 'felo-logo.png'; md5 = '' },
    [pscustomobject]@{ label = 'discord-large-image'; type = 'png'; url = 'felo-discord-large.png'; md5 = '' },
    [pscustomobject]@{ label = 'discord-small-image'; type = 'png'; url = 'felo-discord-small.png'; md5 = '' },
    [pscustomobject]@{ label = 'tray-menu'; type = 'ico'; url = 'felo.ico'; md5 = '' }
  )

  Save-JsonObject $playersPath $players
  Set-ItemProperty -LiteralPath $playersPath -Name IsReadOnly -Value $true -ErrorAction SilentlyContinue
}

# 4. Restart Music Presence if available
if ($musicPresencePath -and (Test-Path -LiteralPath $musicPresencePath)) {
  Start-Process -FilePath $musicPresencePath -WindowStyle Hidden
}
