/**
 * Cross-platform clipboard helper for Felo.
 * Works reliably across Electron desktop, modern browsers (PWA), and non-secure HTTP / mobile contexts.
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof text !== 'string' || text.length === 0) {
    return false
  }

  // 1. Electron Desktop IPC Bridge (native electron.clipboard, unaffected by document focus or permissions)
  if (typeof window !== 'undefined' && window.api?.writeClipboard) {
    try {
      const ok = await window.api.writeClipboard(text)
      if (ok) return true
    } catch (err) {
      console.warn('[Clipboard] window.api.writeClipboard failed, falling back:', err)
    }
  }

  // 2. Modern HTML5 Clipboard API
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.warn('[Clipboard] navigator.clipboard.writeText failed, falling back to DOM execCommand:', err)
    }
  }

  // 3. Document execCommand fallback (works in non-secure contexts or when document lost focus)
  if (typeof document !== 'undefined') {
    try {
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.top = '0'
      textArea.style.left = '-9999px'
      textArea.style.opacity = '0'
      textArea.setAttribute('readonly', '')
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      textArea.setSelectionRange(0, 99999)
      const successful = document.execCommand('copy')
      document.body.removeChild(textArea)
      if (successful) return true
    } catch (err) {
      console.error('[Clipboard] execCommand fallback failed:', err)
    }
  }

  return false
}

export async function readFromClipboard(): Promise<string> {
  // 1. Electron Desktop IPC Bridge (native electron.clipboard.readText without permission prompts)
  if (typeof window !== 'undefined' && window.api?.readClipboard) {
    try {
      const text = await window.api.readClipboard()
      if (typeof text === 'string') return text
    } catch (err) {
      console.warn('[Clipboard] window.api.readClipboard failed, falling back:', err)
    }
  }

  // 2. Modern HTML5 Clipboard API
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.readText === 'function'
  ) {
    try {
      return await navigator.clipboard.readText()
    } catch (err) {
      console.warn('[Clipboard] navigator.clipboard.readText failed:', err)
    }
  }

  return ''
}
