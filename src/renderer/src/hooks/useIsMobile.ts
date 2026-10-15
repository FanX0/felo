import { useState, useEffect } from 'react'

const MOBILE_MAX_WIDTH = 768

export function checkIsMobile(): boolean {
  if (typeof window === 'undefined') return false

  const isCapacitor = Boolean((window as any).Capacitor)
  if (isCapacitor) return true

  // Phone user agents and small viewports
  const isSmallScreen = window.innerWidth <= MOBILE_MAX_WIDTH
  const isPhoneUA = /iPhone|iPod|Android.*Mobile|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )
  const isLandscapePhone = window.innerHeight <= 500 && /Mobi/i.test(navigator.userAgent)

  return isSmallScreen || isPhoneUA || isLandscapePhone
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => checkIsMobile())

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`)

    const updateMatches = () => {
      setIsMobile(checkIsMobile())
    }

    // Set initial
    updateMatches()

    if (mql.addEventListener) {
      mql.addEventListener('change', updateMatches)
    } else {
      mql.addListener(updateMatches)
    }

    window.addEventListener('resize', updateMatches)
    window.addEventListener('orientationchange', updateMatches)
    window.visualViewport?.addEventListener('resize', updateMatches)

    return () => {
      if (mql.removeEventListener) {
        mql.removeEventListener('change', updateMatches)
      } else {
        mql.removeListener(updateMatches)
      }
      window.removeEventListener('resize', updateMatches)
      window.removeEventListener('orientationchange', updateMatches)
      window.visualViewport?.removeEventListener('resize', updateMatches)
    }
  }, [])

  return isMobile
}
