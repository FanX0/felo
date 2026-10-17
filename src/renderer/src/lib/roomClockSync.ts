/**
 * MUSIXQUARE-Parity Room Clock Synchronization & Drift Control Engine
 *
 * Direct port of MUSIXQUARE's network sync and shared clock architecture:
 * 1. Min-RTT Sample Window (shared-clock.ts):
 *    Tracks NTP round-trip samples in a bounded rolling window (up to 60 samples, 120s age limit).
 *    Selects the sample with minimum RTT (lowest network queuing delay) to compute θ (clock offset),
 *    eliminating network packet jitter and clock skew without EMA lag.
 * 2. High-Precision Target Time Projection (sync.ts):
 *    Projects host audio playhead from high-resolution float pulses using getHostNow().
 * 3. Exact MUSIXQUARE Drift Control Contract (sync.ts):
 *    - In-Sync Deadband (drift < 50ms): Unconditional unison, 1.0x rate, 0 seeks, 0 audio dropouts.
 *    - Hard Desync (drift > 2.0s): Clean one-shot seek with 2.5s cooldown (FILE_HARD_RESYNC_DRIFT_SEC = 2).
 *    - Soft Drift (50ms to 2.0s): Requires 3 consecutive observations in the exact same drift direction
 *      plus a 10-second cooldown (FILE_SOFT_RESYNC_REQUIRED_SAMPLES = 3, FILE_SOFT_RESYNC_COOLDOWN_MS = 10000).
 *      Filters out transient packet jitter so playing audio NEVER jumps or jitters during playback.
 */

export interface SyncPulsePayload {
  position: number // Exact float seconds
  hostTimestamp: number // Host Date.now()
  isPlaying: boolean
  trackId?: string
  playbackRate?: number
}

export interface SyncPingPayload {
  guestId: string
  t0: number
}

export interface SyncPongPayload {
  guestId: string
  t0: number // Guest transmit time
  t1: number // Host receive/reply time
}

export type DriftAction = 'in_sync' | 'soft_align' | 'hard_seek'

export interface DriftEvaluationResult {
  action: DriftAction
  drift: number // guestCurrentTime - targetTime (positive = guest ahead, negative = guest behind)
  targetTime: number
  recommendedRate: number
}

interface ClockSample {
  rtt: number
  offset: number
  timestamp: number
}

// ─── MUSIXQUARE Core Constants (Direct Parity) ────────────────────────────────
const MAX_SAMPLES = 60
const SAMPLE_AGE_LIMIT_MS = 120_000 // 2 minutes (MUSIXQUARE shared-clock.ts AGE_LIMIT)
const MAX_RTT_SAMPLE_MS = 1500 // Discard latency spikes > 1.5s
const FILE_HARD_RESYNC_DRIFT_SEC = 2.0 // MUSIXQUARE FILE_HARD_RESYNC_DRIFT_SEC = 2
const FILE_SOFT_RESYNC_DRIFT_SEC = 0.05 // MUSIXQUARE FILE_SOFT_RESYNC_DRIFT_SEC = 0.05 (50ms)
const FILE_SOFT_RESYNC_REQUIRED_SAMPLES = 3 // MUSIXQUARE FILE_SOFT_RESYNC_REQUIRED_SAMPLES = 3
const FILE_SOFT_RESYNC_COOLDOWN_MS = 10_000 // MUSIXQUARE FILE_SOFT_RESYNC_COOLDOWN_MS = 10,000 (10s)
const HARD_SEEK_COOLDOWN_MS = 2500 // 2.5s cooldown between hard seeks

/** Calibrated output advance for Windows local-file playback (matching MUSIXQUARE transport.ts). */
export const WINDOWS_LOCAL_FILE_OUTPUT_ADVANCE_SEC = 0.02

/** Calibrated DAC pipeline latency for Android mobile devices (matching MUSIXQUARE system-sync-compensation.md). */
export const ANDROID_HARDWARE_OUTPUT_LAG_SEC = -0.12 // 120ms advance so mobile Android audio aligns with desktop

export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const navWithUaData = navigator as unknown as { userAgentData?: { platform?: string } }
  const platform = navWithUaData.userAgentData?.platform ?? navigator.platform ?? ''
  return !/iPad|iPhone|iPod|Android/i.test(ua) && (/Windows/i.test(ua) || /^Win/i.test(platform))
}

export function isAndroidPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /Android/i.test(ua)
}

export function getPlatformLocalFileOutputOffset(): number {
  if (isWindowsPlatform()) return WINDOWS_LOCAL_FILE_OUTPUT_ADVANCE_SEC
  if (isAndroidPlatform()) return ANDROID_HARDWARE_OUTPUT_LAG_SEC
  return 0
}

class RoomClockSyncManager {
  private clockOffsetMs = 0
  private isOffsetCalibrated = false
  private samples: ClockSample[] = []
  private guestId = `guest-${Math.random().toString(36).substring(2, 9)}`

  // Drift filter state (MUSIXQUARE sync.ts soft file resync state)
  private softDriftDirection: -1 | 0 | 1 = 0
  private softDriftSamples = 0
  private lastSoftResyncTime = Number.NEGATIVE_INFINITY
  private lastHardSeekTime = Number.NEGATIVE_INFINITY

  public getGuestId(): string {
    return this.guestId
  }

  /**
   * Resets all clock calibration and drift controller states when switching or leaving rooms.
   */
  public reset(): void {
    this.clockOffsetMs = 0
    this.isOffsetCalibrated = false
    this.samples = []
    this.softDriftDirection = 0
    this.softDriftSamples = 0
    this.lastSoftResyncTime = Number.NEGATIVE_INFINITY
    this.lastHardSeekTime = Number.NEGATIVE_INFINITY
  }

  private resetSoftDriftState(): void {
    this.softDriftDirection = 0
    this.softDriftSamples = 0
  }

  /**
   * Called when the user deliberately changes or resets the manual sync offset.
   * Resets soft drift streaks and grants a cooldown window so background pulses
   * adopt the new offset smoothly without rubber-banding or jumping.
   */
  public notifyManualOffsetChanged(): void {
    this.resetSoftDriftState()
    const now = Date.now()
    this.lastSoftResyncTime = now
    this.lastHardSeekTime = now
  }

  private lastWallTime = Date.now()
  private lastMonotonicTime = typeof performance !== 'undefined' ? performance.now() : 0

  /**
   * Processes a Pong response from the Host using MUSIXQUARE Min-RTT selection.
   * rtt = t2 - t0
   * offset = t1 - (t0 + rtt / 2)
   */
  public handlePong(pong: SyncPongPayload): void {
    if (!pong || typeof pong.t0 !== 'number' || typeof pong.t1 !== 'number') return
    if (!Number.isFinite(pong.t0) || !Number.isFinite(pong.t1)) return

    const t2 = Date.now()
    const monoNow = typeof performance !== 'undefined' ? performance.now() : 0

    // Clock discontinuity detection (OS sleep/wake, NTP correction, manual time change)
    if (this.lastMonotonicTime > 0 && monoNow > this.lastMonotonicTime) {
      const elapsedWall = t2 - this.lastWallTime
      const elapsedMono = monoNow - this.lastMonotonicTime
      const clockStep = elapsedWall - elapsedMono
      if (Math.abs(clockStep) > 1000) {
        // Rebase all existing sample timestamps to preserve valid low-RTT samples across clock jumps
        for (const s of this.samples) {
          s.timestamp += clockStep
        }
      }
    }
    this.lastWallTime = t2
    this.lastMonotonicTime = monoNow

    const t0 = pong.t0
    const t1 = pong.t1

    const rtt = t2 - t0
    if (rtt < 0 || rtt > MAX_RTT_SAMPLE_MS) {
      return
    }

    const halfRtt = rtt / 2
    const offset = t1 - (t0 + halfRtt)

    this.samples.push({
      rtt,
      offset,
      timestamp: t2
    })

    // Retain only samples within age limit (120s) and max count (60)
    const now = t2
    this.samples = this.samples.filter((s) => now - s.timestamp < SAMPLE_AGE_LIMIT_MS)
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift()
    }

    // Min-RTT Selection: The sample with smallest RTT experienced the least queueing delay
    const best = this.samples.reduce((a, b) => (a.rtt < b.rtt ? a : b))
    this.clockOffsetMs = best.offset
    this.isOffsetCalibrated = true
  }

  /**
   * Returns whether the clock offset has been calibrated with at least 1 valid round-trip sample.
   */
  public isCalibrated(): boolean {
    return this.isOffsetCalibrated
  }

  /**
   * Returns the current estimated clock offset between Host and Guest in milliseconds.
   */
  public getClockOffsetMs(): number {
    return this.clockOffsetMs
  }

  /**
   * Translates a Host timestamp into the Guest's local time base.
   */
  public toGuestLocalTime(hostTimestamp: number): number {
    if (!this.isOffsetCalibrated) {
      return hostTimestamp
    }
    return hostTimestamp - this.clockOffsetMs
  }

  /**
   * Estimated host time right now (MUSIXQUARE getHostNow() API).
   */
  public getHostNow(): number {
    if (!this.isOffsetCalibrated) {
      return Date.now()
    }
    return Date.now() + this.clockOffsetMs
  }

  /**
   * Computes the precise target playback time from Host position and timestamp.
   *
   * @param hostPosition Exact float seconds from host
   * @param hostTimestamp Host Date.now() timestamp
   * @param isPlaying Whether host is currently playing
   * @param manualOffsetSec User-calibrated manual sync offset (+/- seconds)
   * @param duration Song duration in seconds (optional)
   */
  public calculateTargetTime(
    hostPosition: number,
    hostTimestamp: number,
    isPlaying: boolean,
    manualOffsetSec = 0,
    duration = 0
  ): number {
    // Elapsed time since host recorded this position using getHostNow()
    const hostElapsed = isPlaying ? Math.max(0, (this.getHostNow() - hostTimestamp) / 1000) : 0

    // Clock-skew watchdog: if elapsed is absurdly high (> 30s) due to stale data, clamp to 0
    const safeElapsed = hostElapsed < 30 ? hostElapsed : 0

    const platformOffset = getPlatformLocalFileOutputOffset()
    const rawTarget = hostPosition + safeElapsed + manualOffsetSec + platformOffset
    const target = duration > 0 ? Math.min(duration, Math.max(0, rawTarget)) : Math.max(0, rawTarget)

    return target
  }

  /**
   * Evaluates drift between the guest's current audio time and the target time.
   * Implements MUSIXQUARE's 3-phase drift controller:
   * 1. Deadband (< 50ms): in_sync, 0 actions.
   * 2. Hard drift (> 2.0s): hard_seek with cooldown.
   * 3. Soft drift (50ms - 2.0s): requires 3 consecutive samples in same direction + 10s cooldown.
   */
  public evaluateDrift(
    currentGuestTime: number,
    targetTime: number,
    isPlaying: boolean
  ): DriftEvaluationResult {
    if (!isPlaying) {
      this.resetSoftDriftState()
      return {
        action: 'in_sync',
        drift: 0,
        targetTime,
        recommendedRate: 1.0
      }
    }

    const drift = currentGuestTime - targetTime
    const absDrift = Math.abs(drift)
    const now = Date.now()

    // 1. In-Sync Deadband: Within 50ms, devices are in acoustic unison
    if (absDrift < FILE_SOFT_RESYNC_DRIFT_SEC) {
      this.resetSoftDriftState()
      return {
        action: 'in_sync',
        drift,
        targetTime,
        recommendedRate: 1.0
      }
    }

    // 2. Hard Desync: > 2.0s drift triggers immediate hard resync (respecting cooldown)
    if (absDrift > FILE_HARD_RESYNC_DRIFT_SEC) {
      if (now - this.lastHardSeekTime > HARD_SEEK_COOLDOWN_MS) {
        this.lastHardSeekTime = now
        this.lastSoftResyncTime = now
        this.resetSoftDriftState()
        return {
          action: 'hard_seek',
          drift,
          targetTime,
          recommendedRate: 1.0
        }
      }
      return {
        action: 'in_sync',
        drift,
        targetTime,
        recommendedRate: 1.0
      }
    }

    // 3. Soft Drift (50ms to 2.0s): Must confirm stable drift across 3 consecutive
    // intervals in the same direction, with a 10s cooldown to prevent chasing packet jitter.
    if (now - this.lastSoftResyncTime < FILE_SOFT_RESYNC_COOLDOWN_MS) {
      this.resetSoftDriftState()
      return {
        action: 'in_sync',
        drift,
        targetTime,
        recommendedRate: 1.0
      }
    }

    const direction: -1 | 1 = drift > 0 ? 1 : -1
    if (direction === this.softDriftDirection) {
      this.softDriftSamples += 1
    } else {
      this.softDriftDirection = direction
      this.softDriftSamples = 1
    }

    if (this.softDriftSamples < FILE_SOFT_RESYNC_REQUIRED_SAMPLES) {
      return {
        action: 'in_sync',
        drift,
        targetTime,
        recommendedRate: 1.0
      }
    }

    // 3 consecutive samples confirmed stable drift beyond 50ms and cooldown passed
    this.lastSoftResyncTime = now
    this.resetSoftDriftState()

    // Smooth pitch-preserving rate micro-adjustment:
    // If guest is ahead (direction = 1), slow down by 2% to let host catch up.
    // If guest is behind (direction = -1), speed up by 2% to catch up to host.
    const recommendedRate = direction === 1 ? 0.98 : 1.02

    return {
      action: 'soft_align',
      drift,
      targetTime,
      recommendedRate
    }
  }

  /**
   * Rate adjustment is active for smooth drift compensation.
   */
  public canAdjustRate(): boolean {
    return true
  }
}

export const roomClockSync = new RoomClockSyncManager()
