import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Download,
  Smartphone,
  Apple,
  Monitor,
  Globe,
  Sparkles,
  Share2,
  Plus,
  Check,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  QrCode,
  CheckCircle2,
  Info,
  Headphones
} from 'lucide-react'
import QRCode from 'qrcode'
import { usePwaInstallPrompt } from '../../hooks/usePwaInstallPrompt'
import { isNativeApp } from '../../lib/appConfig'
import {
  FELO_APP_SETUP_URL,
  FELO_GITHUB_RELEASES_URL,
  FELO_ANDROID_APK_URL,
  FELO_IOS_IPA_URL
} from '../../lib/supportConfig'

// Clean monochrome brand icons matching convention styling
function AndroidLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.551 0 .9996.4482.9996.9993.0001.5511-.4485.9997-.9996.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 0 0-.1521-.5676.416.416 0 0 0-.5676.1521l-2.0223 3.503C15.5902 8.4116 13.8533 8.125 12 8.125c-1.8533 0-3.5902.2866-5.1368.8247L4.8409 5.4467a.4161.4161 0 0 0-.5677-.1521.4157.4157 0 0 0-.1521.5676l1.9973 3.4592C2.6889 11.1867.3432 14.6589 0 18.77h24c-.3432-4.1111-2.6889-7.5833-6.1185-9.4486" />
    </svg>
  )
}

function WindowsLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.949-1.8" />
    </svg>
  )
}

function LinuxLogo({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12.002 0c-3.136 0-5.679 2.544-5.679 5.68 0 .807.172 1.573.479 2.267C4.697 8.528 3.19 10.428 3.19 12.72c0 1.258.455 2.41 1.212 3.303-.54.67-.866 1.523-.866 2.454 0 2.112 1.712 3.823 3.823 3.823.47 0 .915-.087 1.326-.242C9.697 22.698 10.8 23.1 12 23.1c1.205 0 2.308-.403 3.32-1.047.41.157.857.247 1.33.247 2.11 0 3.822-1.71 3.822-3.823 0-.934-.33-1.789-.873-2.46.756-.893 1.21-2.043 1.21-3.297 0-2.29-1.505-4.188-3.608-4.77.305-.694.476-1.458.476-2.264C17.677 2.544 15.134 0 12.002 0z" />
    </svg>
  )
}

type PlatformFilter = 'all' | 'mobile' | 'desktop'

export default function DownloadPage() {
  const { os } = usePwaInstallPrompt()

  const [filter, setFilter] = useState<PlatformFilter>('all')
  const [copiedType, setCopiedType] = useState<'android' | 'ios' | null>(null)
  const [showAndroidGuide, setShowAndroidGuide] = useState(false)
  const [showIosGuide, setShowIosGuide] = useState(false)
  const [androidQrDataUrl, setAndroidQrDataUrl] = useState<string>('')
  const [iosQrDataUrl, setIosQrDataUrl] = useState<string>('')

  const mobileSectionRef = useRef<HTMLDivElement | null>(null)
  const desktopSectionRef = useRef<HTMLDivElement | null>(null)

  // Generate dual QR codes: 1 for direct Android APK download, 1 for iOS Web App & handover
  useEffect(() => {
    const androidUrl = FELO_ANDROID_APK_URL
    const iosUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/#/download`
        : 'https://felo.feloapp.workers.dev/#/download'

    const qrOptions = {
      width: 200,
      margin: 1.5,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    }

    QRCode.toDataURL(androidUrl, qrOptions)
      .then(setAndroidQrDataUrl)
      .catch((err) => console.warn('[DownloadPage] Android QR error:', err))

    QRCode.toDataURL(iosUrl, qrOptions)
      .then(setIosQrDataUrl)
      .catch((err) => console.warn('[DownloadPage] iOS QR error:', err))
  }, [])

  const handleCopy = useCallback(async (type: 'android' | 'ios') => {
    const url =
      type === 'android'
        ? FELO_ANDROID_APK_URL
        : typeof window !== 'undefined'
          ? `${window.location.origin}/#/download`
          : 'https://felo.feloapp.workers.dev/#/download'

    try {
      await navigator.clipboard.writeText(url)
      setCopiedType(type)
      setTimeout(() => setCopiedType(null), 2500)
    } catch {
      // fallback
    }
  }, [])

  // Hero auto-detection based on OS
  const getHeroRecommendation = () => {
    switch (os) {
      case 'android':
        return {
          title: 'Android',
          primaryLabel: 'Download for Android (.apk)',
          primaryHref: FELO_ANDROID_APK_URL,
          downloadName: 'Felo.apk',
          icon: <AndroidLogo className="w-5 h-5 text-text" />,
          badge: 'Android 8.0+ • Universal APK',
          note: 'Direct sideload • No Google Play account required'
        }
      case 'ios':
        return {
          title: 'iPhone & iPad',
          primaryLabel: 'Download for iOS (.ipa)',
          primaryHref: FELO_IOS_IPA_URL,
          downloadName: 'Felo.ipa',
          icon: <Apple className="w-5 h-5 text-text" />,
          badge: 'iOS 15.0+ • Sideload IPA Package',
          note: 'Direct sideload via AltStore, SideStore, or TrollStore'
        }
      case 'mac':
        return {
          title: 'macOS',
          primaryLabel: 'Download for Mac (.dmg)',
          primaryHref: FELO_GITHUB_RELEASES_URL,
          icon: <Apple className="w-5 h-5 text-text" />,
          badge: 'macOS 12+ • Apple Silicon & Intel',
          note: 'Hi-res playback & WebRTC room synchronization'
        }
      case 'linux':
        return {
          title: 'Linux',
          primaryLabel: 'Download for Linux (GitHub Releases)',
          primaryHref: FELO_GITHUB_RELEASES_URL,
          icon: <LinuxLogo className="w-5 h-5 text-text" />,
          badge: 'Linux x86_64 / ARM64',
          note: 'AppImage & .deb packages with Discord bot daemon'
        }
      case 'windows':
        return {
          title: 'Windows',
          primaryLabel: 'Download for Windows (.exe)',
          primaryHref: FELO_APP_SETUP_URL,
          downloadName: 'Felo-Setup.exe',
          icon: <WindowsLogo className="w-5 h-5 text-text" />,
          badge: 'Windows 10 / 11 (64-bit) • v1.1.0-beta.1',
          note: 'WASAPI exclusive stream • Discord Rich Presence • Local audio scan'
        }
      case 'other':
      default:
        return null
    }
  }

  // Only show hero recommendation on web if the OS was accurately detected
  const hero = isNativeApp ? null : getHeroRecommendation()

  return (
    <div className="w-full min-h-full flex flex-col items-center px-4 py-8 md:py-16 max-w-6xl mx-auto text-text select-none">
      {/* ─── 1. Industry Standard Hero ──────────────────────────── */}
      <div className="w-full flex flex-col items-center text-center space-y-4 max-w-3xl mb-12">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-surface-elevated border border-border text-text-muted text-xs font-semibold tracking-wide shadow-xs">
          <Sparkles className="w-3.5 h-3.5 text-text" />
          <span>Felo Music • Cross-Platform Download Center</span>
        </div>

        <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-[1.1] text-text">
          Download Felo
        </h1>

        <p className="text-sm md:text-base text-text-muted max-w-2xl leading-relaxed">
          Enjoy bit-perfect lossless playback, real-time Listen Together rooms, and complete library
          management on all your mobile and desktop devices.
        </p>

        {/* Dynamic Recommended CTA Card (Only shown if OS is accurately detected and running on web) */}
        {hero && (
          <div className="w-full max-w-md mt-6 p-6 sm:p-7 rounded-2xl bg-surface-elevated border border-border shadow-sm flex flex-col items-center gap-4 transition-all hover:border-border/80">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted">
              {hero.icon}
              <span>Recommended for your {hero.title}</span>
            </div>

            <a
              href={hero.primaryHref}
              download={hero.downloadName}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full h-12 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-sm sm:text-base flex items-center justify-center gap-2.5 shadow-sm transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer"
            >
              <Download className="w-4 h-4 stroke-[2.5]" />
              <span>{hero.primaryLabel}</span>
            </a>

            <div className="text-center space-y-1">
              <div className="text-xs font-semibold text-text">{hero.badge}</div>
              <div className="text-[11px] text-text-muted">{hero.note}</div>
            </div>
          </div>
        )}

        {/* Filter / Quick-Nav Switcher Tabs */}
        <div className="flex items-center justify-center p-1 rounded-full bg-surface-elevated border border-border mt-6 gap-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              filter === 'all'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text-muted hover:text-text hover:bg-hover'
            }`}
          >
            All Platforms
          </button>
          <button
            type="button"
            onClick={() => {
              setFilter('mobile')
              mobileSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
            }}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              filter === 'mobile'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text-muted hover:text-text hover:bg-hover'
            }`}
          >
            Mobile (Android & iOS)
          </button>
          <button
            type="button"
            onClick={() => {
              setFilter('desktop')
              desktopSectionRef.current?.scrollIntoView({ behavior: 'smooth' })
            }}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              filter === 'desktop'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text-muted hover:text-text hover:bg-hover'
            }`}
          >
            Desktop (PC, Mac, Linux)
          </button>
        </div>
      </div>

      {/* ─── 2. Mobile Platforms (Android & iOS) ────────────────── */}
      {(filter === 'all' || filter === 'mobile') && (
        <div ref={mobileSectionRef} className="w-full space-y-6 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-border/60 pb-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <Smartphone className="w-4 h-4 text-text" />
                <span>Mobile Apps</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-text mt-1">Felo for Mobile</h2>
            </div>
            <p className="text-xs text-text-muted">
              Lossless streaming & Listen Together on your phone or tablet
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* ── CARD: ANDROID ── */}
            <div className="p-6 sm:p-8 rounded-2xl bg-surface-elevated border border-border shadow-xs flex flex-col justify-between hover:border-border/80 transition-all">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center text-text shadow-xs">
                    <AndroidLogo className="w-6 h-6" />
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface border border-border text-text-muted">
                    Android 8.0+
                  </span>
                </div>

                <div>
                  <h3 className="text-2xl font-black tracking-tight text-text">Android App</h3>
                  <p className="text-xs sm:text-sm text-text-muted mt-1 leading-relaxed">
                    Standalone native app with background audio streaming, lock screen media
                    controls, and low-latency Listen Together synchronization.
                  </p>
                </div>

                <div className="space-y-2 text-xs text-text-muted pt-3 border-t border-border/40">
                  <div className="flex items-center gap-2 text-text font-medium">
                    <CheckCircle2 className="w-4 h-4 text-text shrink-0" />
                    <span>Bit-perfect FLAC audio playback with low battery overhead</span>
                  </div>
                  <div className="flex items-center gap-2 text-text font-medium">
                    <CheckCircle2 className="w-4 h-4 text-text shrink-0" />
                    <span>Lock screen notification controls & album art sync</span>
                  </div>
                  <div className="flex items-center gap-2 text-text font-medium">
                    <CheckCircle2 className="w-4 h-4 text-text shrink-0" />
                    <span>Direct APK sideload or instant 1-click Web App</span>
                  </div>
                </div>
                {/* ── Scan to Download QR Box ── */}
                <div className="pt-3 border-t border-border/40">
                  <div className="p-3.5 sm:p-4 rounded-xl bg-surface border border-border flex flex-col sm:flex-row items-center gap-4 transition hover:border-border/80">
                    <div className="p-2 bg-white rounded-xl shadow-xs shrink-0 border border-white/10">
                      {androidQrDataUrl ? (
                        <img
                          src={androidQrDataUrl}
                          alt="Scan to download Android APK"
                          className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg"
                        />
                      ) : (
                        <div className="w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center bg-zinc-100 rounded-lg text-zinc-400">
                          <QrCode className="w-7 h-7 animate-pulse text-zinc-400" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-bold text-text">
                          <QrCode className="w-3.5 h-3.5" />
                          <span>Scan for Direct APK</span>
                        </div>
                        <p className="text-[11px] text-text-muted leading-relaxed">
                          Scan with your phone camera to download <code>Felo.apk</code> directly on your phone.
                        </p>
                        <div className="text-[10px] text-text-muted font-medium">
                          Android 8.0+ Universal
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopy('android')}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-elevated hover:bg-hover border border-border text-[11px] font-semibold text-text transition active:scale-95 cursor-pointer"
                      >
                        {copiedType === 'android' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="font-bold text-text">APK Link Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-text-muted" />
                            <span>Copy Android APK Link</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 space-y-3">
                <a
                  href={FELO_ANDROID_APK_URL}
                  download="Felo.apk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer"
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>Download for Android (.apk)</span>
                </a>

                {/* Sideload Guide Accordion */}
                <button
                  type="button"
                  onClick={() => setShowAndroidGuide(!showAndroidGuide)}
                  className="w-full text-center text-xs text-text-muted hover:text-text flex items-center justify-center gap-1.5 py-1 cursor-pointer transition"
                >
                  <span>How to install the APK on Android</span>
                  {showAndroidGuide ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {showAndroidGuide && (
                  <div className="p-4 rounded-xl bg-surface border border-border text-xs text-text-muted space-y-2 animate-in fade-in-50">
                    <div className="font-bold text-text flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5" />
                      <span>Quick Android Sideload Guide:</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1.5 pl-1 leading-relaxed">
                      <li>Tap <b>Download for Android (.apk)</b> above to download <code>Felo.apk</code>.</li>
                      <li>If your browser shows &quot;File might be harmful&quot;, tap <b>Download anyway</b>.</li>
                      <li>Open the downloaded APK from notifications or your Files app, then tap <b>Install</b> (toggle &quot;Allow from this source&quot; if prompted).</li>
                    </ol>
                  </div>
                )}

                <div className="text-center text-[11px] text-text-muted">
                  Direct sideload • Free open-source player
                </div>
              </div>
            </div>

            {/* ── CARD: IOS ── */}
            <div className="p-6 sm:p-8 rounded-2xl bg-surface-elevated border border-border shadow-xs flex flex-col justify-between hover:border-border/80 transition-all">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center text-text shadow-xs">
                    <Apple className="w-6 h-6" />
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-surface border border-border text-text-muted">
                    iOS 15.0+
                  </span>
                </div>

                <div>
                  <h3 className="text-2xl font-black tracking-tight text-text">iOS (iPhone & iPad)</h3>
                  <p className="text-xs sm:text-sm text-text-muted mt-1 leading-relaxed">
                    Enjoy Felo on iOS as a standalone audio player with background playback, lock screen media controls, and Listen Together sync.
                  </p>
                </div>

                <div className="space-y-2 text-xs text-text-muted pt-3 border-t border-border/40">
                  <div className="flex items-center gap-2 text-text font-medium">
                    <CheckCircle2 className="w-4 h-4 text-text shrink-0" />
                    <span>Lossless audio streaming with background lock screen playback</span>
                  </div>
                  <div className="flex items-center gap-2 text-text font-medium">
                    <CheckCircle2 className="w-4 h-4 text-text shrink-0" />
                    <span>Real-time group listening with synchronized Listen Together rooms</span>
                  </div>
                  <div className="flex items-center gap-2 text-text font-medium">
                    <CheckCircle2 className="w-4 h-4 text-text shrink-0" />
                    <span>Install via AltStore, SideStore, Sideloadly, TrollStore, or Safari PWA</span>
                  </div>
                </div>

                {/* ── Scan to Download QR Box ── */}
                <div className="pt-3 border-t border-border/40">
                  <div className="p-3.5 sm:p-4 rounded-xl bg-surface border border-border flex flex-col sm:flex-row items-center gap-4 transition hover:border-border/80">
                    <div className="p-2 bg-white rounded-xl shadow-xs shrink-0 border border-white/10">
                      {iosQrDataUrl ? (
                        <img
                          src={iosQrDataUrl}
                          alt="Scan to open on iOS Safari"
                          className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg"
                        />
                      ) : (
                        <div className="w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center bg-zinc-100 rounded-lg text-zinc-400">
                          <QrCode className="w-7 h-7 animate-pulse text-zinc-400" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left">
                      <div className="space-y-0.5">
                        <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-bold text-text">
                          <QrCode className="w-3.5 h-3.5" />
                          <span>Scan for Safari &amp; IPA</span>
                        </div>
                        <p className="text-[11px] text-text-muted leading-relaxed">
                          Scan with your camera to open on Safari (Add to Home Screen) or download the standalone IPA.
                        </p>
                        <div className="text-[10px] text-text-muted font-medium">
                          Add to Home Screen • Sideload IPA
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopy('ios')}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-elevated hover:bg-hover border border-border text-[11px] font-semibold text-text transition active:scale-95 cursor-pointer"
                      >
                        {copiedType === 'ios' ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="font-bold text-text">iOS Link Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-text-muted" />
                            <span>Copy iOS Link</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 space-y-3">
                <a
                  href={FELO_IOS_IPA_URL}
                  download="Felo.ipa"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer"
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>Download for iOS (.ipa)</span>
                </a>

                {/* Sideload Guide Accordion */}
                <button
                  type="button"
                  onClick={() => setShowIosGuide(!showIosGuide)}
                  className="w-full text-center text-xs text-text-muted hover:text-text flex items-center justify-center gap-1.5 py-1 cursor-pointer transition"
                >
                  <span>How to install the IPA on iOS</span>
                  {showIosGuide ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {showIosGuide && (
                  <div className="p-4 rounded-xl bg-surface border border-border text-xs text-text-muted space-y-3 animate-in fade-in-50">
                    <div className="space-y-1.5">
                      <div className="font-bold text-text flex items-center gap-1.5">
                        <Info className="w-3.5 h-3.5" />
                        <span>Method 1: Sideload IPA (AltStore / SideStore / Sideloadly)</span>
                      </div>
                      <ol className="list-decimal list-inside space-y-1 pl-1 leading-relaxed">
                        <li>Tap <b>Download for iOS (.ipa)</b> above to download <code>Felo.ipa</code>.</li>
                        <li>Open your sideload tool (AltStore, SideStore, Sideloadly, or TrollStore).</li>
                        <li>Select <code>Felo.ipa</code> and install it to your iPhone or iPad with zero jailbreak required.</li>
                      </ol>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-border/40">
                      <div className="font-bold text-text flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Method 2: Safari &quot;Add to Home Screen&quot; (Zero Install)</span>
                      </div>
                      <ol className="list-decimal list-inside space-y-1 pl-1 leading-relaxed">
                        <li>In Safari, tap the <b>Share</b> icon (the box with an arrow <Share2 className="w-3 h-3 inline mx-0.5" />).</li>
                        <li>Scroll down and tap <b>Add to Home Screen</b> (<Plus className="w-3 h-3 inline mx-0.5" />).</li>
                        <li>Tap <b>Add</b>. Felo runs as a standalone app with background playback!</li>
                      </ol>
                    </div>
                  </div>
                )}

                <div className="text-center text-[11px] text-text-muted">
                  No subscriptions • Free open-source player
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── 3. Desktop Platforms (Windows, Mac, Linux) ──────────── */}
      {(filter === 'all' || filter === 'desktop') && (
        <div ref={desktopSectionRef} className="w-full space-y-6 pt-12">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-border/60 pb-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-text-muted flex items-center gap-1.5">
                <Monitor className="w-4 h-4 text-text" />
                <span>Desktop Apps</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black text-text mt-1">Felo for Desktop</h2>
            </div>
            <p className="text-xs text-text-muted">
              WASAPI exclusive streaming, Discord Rich Presence bot, and local collection indexing
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Windows */}
            <div className="p-6 sm:p-7 rounded-2xl bg-surface-elevated border border-border shadow-xs flex flex-col justify-between hover:border-border/80 transition-all">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center text-text">
                    <WindowsLogo className="w-6 h-6" />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-surface border border-border text-text-muted">
                    Windows 10 / 11
                  </span>
                </div>

                <div>
                  <h3 className="text-xl font-black text-text">Windows</h3>
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">
                    Installer package with WASAPI bit-perfect streaming, Discord Rich Presence, and
                    local directory scanner.
                  </p>
                </div>

                <div className="text-xs space-y-1.5 text-text-muted pt-2 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <span>Architecture:</span>
                    <span className="font-semibold text-text">64-bit (x64)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Format:</span>
                    <span className="font-semibold text-text">.exe Installer</span>
                  </div>
                </div>
              </div>

              <div className="pt-6">
                <a
                  href={FELO_APP_SETUP_URL}
                  download="Felo-Setup.exe"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-all duration-200 hover:scale-[1.02] active:scale-95 cursor-pointer"
                >
                  <Download className="w-4 h-4 stroke-[2.5]" />
                  <span>Download for Windows (.exe)</span>
                </a>
              </div>
            </div>

            {/* macOS */}
            <div className="p-6 sm:p-7 rounded-2xl bg-surface-elevated border border-border shadow-xs flex flex-col justify-between hover:border-border/80 transition-all">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center text-text">
                    <Apple className="w-6 h-6" />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-surface border border-border text-text-muted">
                    macOS 12+
                  </span>
                </div>

                <div>
                  <h3 className="text-xl font-black text-text">macOS</h3>
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">
                    Native macOS build for Apple Silicon (M1/M2/M3/M4) and Intel Macs with CoreAudio
                    hi-res engine.
                  </p>
                </div>

                <div className="text-xs space-y-1.5 text-text-muted pt-2 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <span>Architecture:</span>
                    <span className="font-semibold text-text">Universal DMG</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Format:</span>
                    <span className="font-semibold text-text">.dmg</span>
                  </div>
                </div>
              </div>

              <div className="pt-6">
                <a
                  href={FELO_GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-full bg-surface hover:bg-hover border border-border text-text font-semibold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Download for Mac (.dmg)</span>
                </a>
              </div>
            </div>

            {/* Linux */}
            <div className="p-6 sm:p-7 rounded-2xl bg-surface-elevated border border-border shadow-xs flex flex-col justify-between hover:border-border/80 transition-all">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center text-text">
                    <LinuxLogo className="w-6 h-6" />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-surface border border-border text-text-muted">
                    Linux
                  </span>
                </div>

                <div>
                  <h3 className="text-xl font-black text-text">Linux</h3>
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">
                    Universal builds for Ubuntu, Debian, Fedora, Arch, and major distributions with
                    Discord bot support.
                  </p>
                </div>

                <div className="text-xs space-y-1.5 text-text-muted pt-2 border-t border-border/40">
                  <div className="flex items-center justify-between">
                    <span>Architecture:</span>
                    <span className="font-semibold text-text">x86_64 / ARM64</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Format:</span>
                    <span className="font-semibold text-text">AppImage / .deb</span>
                  </div>
                </div>
              </div>

              <div className="pt-6">
                <a
                  href={FELO_GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full h-11 rounded-full bg-surface hover:bg-hover border border-border text-text font-semibold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Download for Linux</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── 4. Instant Web Player Card (Native App Only - Hidden on Web) ──── */}
      {isNativeApp && (
        <div className="w-full mt-10 p-6 sm:p-8 rounded-2xl bg-surface-elevated border border-border shadow-xs flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2 text-center md:text-left">
            <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text-muted">
              <Globe className="w-4 h-4 text-text" />
              <span>Instant Access</span>
            </div>
            <h3 className="text-2xl font-black text-text">Listen Instantly in your Web Browser</h3>
            <p className="text-xs sm:text-sm text-text-muted max-w-xl leading-relaxed">
              Prefer not to download? Launch the Felo Web Player to join listening rooms, stream
              lossless audio, and discover top charts in seconds with zero install.
            </p>
          </div>

          <a
            href="https://felo.feloapp.workers.dev"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if ((window as any).api?.openExternal) {
                e.preventDefault()
                void (window as any).api.openExternal('https://felo.feloapp.workers.dev')
              }
            }}
            className="shrink-0 h-11 px-6 rounded-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xs transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer"
          >
            <Headphones className="w-4 h-4 stroke-[2.5]" />
            <span>Launch Web Player</span>
          </a>
        </div>
      )}

      {/* ─── 6. Feature Matrix & Capabilities ────────────────────── */}
      <div className="w-full mt-14 space-y-4">
        <div className="text-center space-y-1 mb-6">
          <h3 className="text-2xl font-black text-text">Platform Comparison</h3>
          <p className="text-xs text-text-muted">Choose the app experience that best fits your workflow</p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border bg-surface-elevated shadow-xs">
          <table className="w-full text-left text-xs text-text-muted">
            <thead className="bg-surface text-text font-bold uppercase tracking-wider text-[11px] border-b border-border">
              <tr>
                <th className="py-3.5 px-5">Feature</th>
                <th className="py-3.5 px-5">Android App (.APK)</th>
                <th className="py-3.5 px-5">iOS (Safari PWA)</th>
                <th className="py-3.5 px-5">Desktop (Windows / Mac)</th>
                <th className="py-3.5 px-5">Web Browser</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              <tr>
                <td className="py-3.5 px-5 font-semibold text-text">Bit-Perfect Lossless FLAC</td>
                <td className="py-3.5 px-5 text-text font-bold">Supported</td>
                <td className="py-3.5 px-5 text-text font-bold">Supported</td>
                <td className="py-3.5 px-5 text-text font-bold">Supported (WASAPI)</td>
                <td className="py-3.5 px-5 text-text font-bold">Supported</td>
              </tr>
              <tr>
                <td className="py-3.5 px-5 font-semibold text-text">Listen Together (Realtime Sync)</td>
                <td className="py-3.5 px-5 text-text font-bold">WebRTC P2P</td>
                <td className="py-3.5 px-5 text-text font-bold">WebRTC P2P</td>
                <td className="py-3.5 px-5 text-text font-bold">WebRTC P2P</td>
                <td className="py-3.5 px-5 text-text font-bold">WebRTC P2P</td>
              </tr>
              <tr>
                <td className="py-3.5 px-5 font-semibold text-text">Local Music Collection Scan</td>
                <td className="py-3.5 px-5 text-text font-bold">Internal Storage</td>
                <td className="py-3.5 px-5">Web Audio Cache</td>
                <td className="py-3.5 px-5 text-text font-bold">Native Disk Scan</td>
                <td className="py-3.5 px-5">IndexedDB Cache</td>
              </tr>
              <tr>
                <td className="py-3.5 px-5 font-semibold text-text">Discord Bot Music Control</td>
                <td className="py-3.5 px-5">N/A</td>
                <td className="py-3.5 px-5">N/A</td>
                <td className="py-3.5 px-5 text-text font-bold">Built-in Daemon</td>
                <td className="py-3.5 px-5">Connected Room</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
