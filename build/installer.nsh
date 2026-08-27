!macro customInstall
  DetailPrint "Installing Felo Music Presence configuration..."
  ExecWait '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\music-presence\install-felo-music-presence.ps1" -AssetRoot "$INSTDIR\resources\music-presence"'

  DetailPrint "Installing Felo downloader dependencies..."
  ExecWait '"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\downloader\install-download-deps.ps1"'
!macroend
