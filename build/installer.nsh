!macro customInstall
  DetailPrint "Installing Felo Music Presence configuration..."
  nsExec::Exec '"powershell.exe" -WindowStyle Hidden -NonInteractive -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\music-presence\install-felo-music-presence.ps1" -AssetRoot "$INSTDIR\resources\music-presence"'

  DetailPrint "Installing Felo downloader dependencies (Python & Streamrip)..."
  nsExec::Exec '"powershell.exe" -WindowStyle Hidden -NonInteractive -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\downloader\install-download-deps.ps1"'
!macroend

