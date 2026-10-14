!macro customInstall
  DetailPrint "Installing Felo Music Presence configuration..."
  nsExec::Exec 'powershell.exe -ExecutionPolicy Bypass -NoProfile -NonInteractive -WindowStyle Hidden -File "$INSTDIR\resources\music-presence\install-felo-music-presence.ps1" -AssetRoot "$INSTDIR\resources\music-presence"'

  DetailPrint "Installing optional downloader tools (yt-dlp & FFmpeg)..."
  nsExec::Exec 'powershell.exe -ExecutionPolicy Bypass -NoProfile -NonInteractive -WindowStyle Hidden -File "$INSTDIR\resources\downloader\install-download-deps.ps1"'
!macroend

