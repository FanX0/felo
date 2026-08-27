# Felo Downloader Tools

Qobuz, Deezer, and Soulseek are implemented natively in pure TypeScript / Node.js and require no external binaries or runtimes.

For optional YouTube audio ripping, the following tools can be placed in `resources/downloader`:

- `bin/yt-dlp.exe`
- `bin/ffmpeg.exe`
- `ffmpeg/bin/ffmpeg.exe`

The installer also includes `install-download-deps.ps1`, which can automatically fetch standalone `yt-dlp.exe` and `ffmpeg` if needed.
