# Felo Downloader Dependencies

Files in this folder are copied into the installed app as `resources/downloader`.

Supported bundled layouts:

- `bin/rip.exe`
- `bin/yt-dlp.exe`
- `bin/ffmpeg.exe`
- `python/python.exe`
- `python/Scripts/rip.exe`
- `python/Scripts/yt-dlp.exe`
- `ffmpeg/bin/ffmpeg.exe`

The installer also includes `install-download-deps.ps1`, which can install Python,
Streamrip, yt-dlp, and ffmpeg on the target PC when called from the NSIS install hook.
