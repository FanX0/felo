/**
 * Device Information & Detection Utility
 * Industry-standard device naming and model detection (Spotify Connect / Apple AirPlay style)
 */

export type DeviceType = 'phone' | 'tablet' | 'desktop' | 'browser'

export interface DeviceInfo {
  name: string
  model: string
  os: string
  browser: string
  type: DeviceType
  isMobile: boolean
  isTablet: boolean
}

const CUSTOM_NAME_KEY = 'felo_custom_device_name'

/**
 * Detects the specific model and operating system from navigator properties
 */
export function detectDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      name: 'Felo Player',
      model: 'Desktop',
      os: 'Unknown',
      browser: 'Unknown',
      type: 'desktop',
      isMobile: false,
      isTablet: false
    }
  }

  const ua = navigator.userAgent || ''
  const isTouch = navigator.maxTouchPoints > 0
  let os = 'Unknown OS'
  let model = 'Web Browser'
  let type: DeviceType = 'desktop'
  let isMobile = false
  let isTablet = false

  // 1. Apple iOS / iPadOS
  if (/iPad/i.test(ua) || (isTouch && /Macintosh/i.test(ua))) {
    os = 'iPadOS'
    model = 'iPad'
    type = 'tablet'
    isTablet = true
    isMobile = true
  } else if (/iPhone/i.test(ua)) {
    os = 'iOS'
    model = 'iPhone'
    type = 'phone'
    isMobile = true
  } else if (/iPod/i.test(ua)) {
    os = 'iOS'
    model = 'iPod Touch'
    type = 'phone'
    isMobile = true
  }
  // 2. Android
  else if (/Android/i.test(ua)) {
    os = 'Android'
    isMobile = true
    const isAndroidTablet = /Tablet|Tab/i.test(ua) || !/Mobile/i.test(ua)
    type = isAndroidTablet ? 'tablet' : 'phone'
    isTablet = isAndroidTablet

    if (/SM-[A-Z0-9]+|Samsung/i.test(ua)) {
      model = 'Samsung Galaxy'
    } else if (/Pixel\s*\d*[a-zA-Z]*/i.test(ua)) {
      const pixelMatch = ua.match(/Pixel\s*\d*[a-zA-Z]*/i)
      model = pixelMatch ? `Google ${pixelMatch[0]}` : 'Google Pixel'
    } else if (/Xiaomi|Redmi|POCO/i.test(ua)) {
      model = 'Xiaomi Device'
    } else if (/OnePlus/i.test(ua)) {
      model = 'OnePlus'
    } else if (/Oppo/i.test(ua)) {
      model = 'OPPO'
    } else if (/Vivo/i.test(ua)) {
      model = 'vivo'
    } else if (/Huawei|HONOR/i.test(ua)) {
      model = 'Huawei'
    } else {
      model = isAndroidTablet ? 'Android Tablet' : 'Android Phone'
    }
  }
  // 3. Desktop Operating Systems
  else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'macOS'
    model = 'Mac'
    type = 'desktop'
  } else if (/Windows/i.test(ua)) {
    os = 'Windows'
    model = 'Windows PC'
    type = 'desktop'
  } else if (/Linux/i.test(ua)) {
    os = 'Linux'
    model = 'Linux PC'
    type = 'desktop'
  }

  // 4. Browser Detection
  let browser = 'Browser'
  if (/Edg\//i.test(ua)) {
    browser = 'Edge'
  } else if (/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) {
    browser = 'Chrome'
  } else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    browser = 'Safari'
  } else if (/Firefox\//i.test(ua)) {
    browser = 'Firefox'
  }

  // Check for custom user-configured name
  const savedName = localStorage.getItem(CUSTOM_NAME_KEY)?.trim()
  const name = savedName || (isMobile ? model : `${model} (${browser})`)

  return {
    name,
    model,
    os,
    browser,
    type,
    isMobile,
    isTablet
  }
}

/**
 * Returns the friendly display name for this device (e.g. "iPhone", "Samsung Galaxy", "Farid's Phone")
 */
export function getDeviceDisplayName(): string {
  const custom = localStorage.getItem(CUSTOM_NAME_KEY)?.trim()
  if (custom) return custom

  const info = detectDeviceInfo()
  if (info.isMobile) {
    return info.model
  }
  return info.name
}

/**
 * Set a custom user-defined name for this device
 */
export function setCustomDeviceName(name: string): void {
  const clean = name.trim()
  if (clean) {
    localStorage.setItem(CUSTOM_NAME_KEY, clean)
  } else {
    localStorage.removeItem(CUSTOM_NAME_KEY)
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('felo:device-name-changed', { detail: clean }))
  }
}
