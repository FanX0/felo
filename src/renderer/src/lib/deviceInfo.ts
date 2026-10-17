/**
 * Device Information & Detection Utility
 * Industry-standard device classification and professional naming (Spotify Connect / Apple AirPlay style)
 * Distinguishes accurately between:
 * 1. Web PC (Chrome / Edge / Safari / Firefox on PC/Mac/Linux)
 * 2. App PC (Felo Desktop Electron Native)
 * 3. Web Mobile (Safari / Chrome on iPhone/iPad/Android)
 * 4. App Mobile (Felo App Capacitor Native APK/iOS)
 */

export type DeviceCategory = 'app_pc' | 'web_pc' | 'app_mobile' | 'web_mobile'
export type DeviceType = 'phone' | 'tablet' | 'desktop' | 'browser'

export interface DeviceInfo {
  name: string
  canonicalName: string
  customName: string | null
  category: DeviceCategory
  categoryLabel: string
  model: string
  os: string
  browser: string
  type: DeviceType
  isElectron: boolean
  isCapacitor: boolean
  isMobile: boolean
  isTablet: boolean
}

const CUSTOM_NAME_KEY = 'felo_custom_device_name'

/**
 * Detects the specific model, operating system, and runtime container
 */
export function detectDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      name: 'Felo Desktop (PC)',
      canonicalName: 'Felo Desktop (PC)',
      customName: null,
      category: 'app_pc',
      categoryLabel: 'Desktop App',
      model: 'Desktop',
      os: 'Unknown',
      browser: 'Electron',
      type: 'desktop',
      isElectron: true,
      isCapacitor: false,
      isMobile: false,
      isTablet: false
    }
  }

  const isElectron = Boolean((window as any).electron || (window as any).api)
  const isCapacitor = Boolean(
    (window as any).Capacitor?.isNativePlatform?.() || (window as any).Capacitor
  )

  const ua = navigator.userAgent || ''
  const isTouch = navigator.maxTouchPoints > 0
  let os = 'Unknown OS'
  let model = 'PC'
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
  if (isElectron) {
    browser = 'Felo Desktop'
  } else if (/SamsungBrowser/i.test(ua)) {
    browser = 'Samsung Internet'
  } else if (/Edg\//i.test(ua)) {
    browser = 'Edge'
  } else if (/OPR\/|Opera/i.test(ua)) {
    browser = 'Opera'
  } else if (/Chrome\//i.test(ua) && !/Chromium\//i.test(ua)) {
    browser = 'Chrome'
  } else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) {
    browser = isMobile ? 'Safari' : 'Safari'
  } else if (/Firefox\//i.test(ua)) {
    browser = 'Firefox'
  }

  // 5. True Category Derivation
  let category: DeviceCategory
  let categoryLabel: string
  let canonicalName: string

  if (isElectron) {
    category = 'app_pc'
    categoryLabel = 'Desktop App'
    canonicalName = `Felo Desktop (${os})`
  } else if (isCapacitor) {
    category = 'app_mobile'
    categoryLabel = 'Mobile App'
    canonicalName = `Felo App (${model})`
  } else if (isMobile || isTablet) {
    category = 'web_mobile'
    categoryLabel = 'Mobile Web'
    canonicalName = `${browser} (${model} Web)`
  } else {
    category = 'web_pc'
    categoryLabel = 'Web Browser (PC)'
    canonicalName = `${browser} (${os} Web)`
  }

  // Check for custom user-configured name
  const customName = localStorage.getItem(CUSTOM_NAME_KEY)?.trim() || null
  const name = customName || canonicalName

  return {
    name,
    canonicalName,
    customName,
    category,
    categoryLabel,
    model,
    os,
    browser,
    type,
    isElectron,
    isCapacitor,
    isMobile,
    isTablet
  }
}

/**
 * Returns the friendly display name for this device
 */
export function getDeviceDisplayName(): string {
  const info = detectDeviceInfo()
  return info.name
}

/**
 * Returns the canonical auto-generated professional name for this device
 */
export function getDeviceCanonicalName(): string {
  const info = detectDeviceInfo()
  return info.canonicalName
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

/**
 * Returns a globally unique and stable identifier for this device instance.
 * Prefixed with true category (e.g. app-pc-..., web-pc-..., app-mobile-..., web-mobile-...).
 * For web browser sessions, appends a tab instance suffix so distinct tabs arbitrate cleanly.
 */
export function getCurrentDeviceId(): string {
  if (typeof window === 'undefined') return 'app-pc-main'
  let id = localStorage.getItem('felo_device_id')
  const info = detectDeviceInfo()
  const expectedPrefix = info.category.replace('_', '-')

  if (!id || !id.startsWith(expectedPrefix)) {
    id = `${expectedPrefix}-${Math.random().toString(36).substring(2, 10)}-${Date.now().toString(36)}`
    localStorage.setItem('felo_device_id', id)
  }

  // For web sessions, attach tab ID
  if (!info.isElectron && typeof sessionStorage !== 'undefined') {
    let tabId = sessionStorage.getItem('felo_tab_instance_id')
    if (!tabId) {
      tabId = Math.random().toString(36).substring(2, 7)
      sessionStorage.setItem('felo_tab_instance_id', tabId)
    }
    return `${id}-${tabId}`
  }
  return id
}

/**
 * Safely resolves the true DeviceCategory from any device record (new or legacy)
 */
export function getDeviceCategory(device: {
  device_type?: string
  device_category?: DeviceCategory
  device_name?: string
  local_ip?: string
}): DeviceCategory {
  if (device.device_category) return device.device_category

  const type = device.device_type
  if (type === 'app_pc' || type === 'web_pc' || type === 'app_mobile' || type === 'web_mobile') {
    return type
  }

  const name = device.device_name || ''
  if (/Felo App/i.test(name)) return 'app_mobile'
  if (/Felo Desktop/i.test(name) || device.local_ip) return 'app_pc'
  if (/\(.*?Web\)/i.test(name) || /Chrome|Safari|Firefox|Edge|Browser/i.test(name)) {
    if (/Mobile|iPhone|Android|iPad/i.test(name) || type === 'mobile') {
      return 'web_mobile'
    }
    return 'web_pc'
  }

  if (type === 'mobile') return 'web_mobile'
  return device.local_ip ? 'app_pc' : 'web_pc'
}

/**
 * Returns a human-friendly category label
 */
export function getDeviceCategoryLabel(category: DeviceCategory): string {
  switch (category) {
    case 'app_pc':
      return 'Desktop App'
    case 'web_pc':
      return 'Web Browser'
    case 'app_mobile':
      return 'Mobile App'
    case 'web_mobile':
      return 'Mobile Web'
  }
}

/**
 * Checks if a device is a PC (either Desktop App or Web Browser on PC)
 */
export function isPcDevice(
  categoryOrDevice?: DeviceCategory | string | { device_type?: string; device_category?: DeviceCategory | string; device_name?: string; local_ip?: string } | null
): boolean {
  if (!categoryOrDevice) return false
  const cat = typeof categoryOrDevice === 'string' ? categoryOrDevice : getDeviceCategory(categoryOrDevice as any)
  return cat === 'app_pc' || cat === 'web_pc' || cat === 'desktop'
}

/**
 * Checks if a device is a Mobile device (either Native App or Mobile Web)
 */
export function isMobileDevice(
  categoryOrDevice?: DeviceCategory | string | { device_type?: string; device_category?: DeviceCategory | string; device_name?: string; local_ip?: string } | null
): boolean {
  if (!categoryOrDevice) return false
  const cat = typeof categoryOrDevice === 'string' ? categoryOrDevice : getDeviceCategory(categoryOrDevice as any)
  return cat === 'app_mobile' || cat === 'web_mobile' || cat === 'mobile' || cat === 'phone' || cat === 'tablet'
}

/**
 * Strips raw IPs, technical delimiters, and redundant platform tags from device names
 * for clean, professional user-facing display (Spotify Connect / Apple AirPlay style)
 */
export function getCleanDeviceName(name?: string | null, fallback = 'Device'): string {
  if (!name || typeof name !== 'string') return fallback
  let clean = name.trim()
  if (!clean) return fallback

  // 1. Remove IP address with optional port, bullets, or dashes (e.g. " • 192.168.1.12:4788")
  clean = clean.replace(/\s*[•·-]\s*\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, '')

  // 2. Remove IP inside parentheses (e.g. "(192.168.1.12)" or "(192.168.1.12:4788)")
  clean = clean.replace(/\(\s*\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b\s*\)/g, '')

  // 3. Remove redundant OS tags inside parentheses (e.g. "Felo Desktop (Windows)" -> "Felo Desktop")
  clean = clean.replace(/\(\s*(?:Windows|macOS|Linux|iOS|Android|iPadOS)\s*\)/gi, '')

  // 4. Remove leftover empty parentheses or dangling separators
  clean = clean.replace(/\(\s*\)/g, '').replace(/\s*[•·-]\s*$/, '').trim()

  return clean || fallback
}
