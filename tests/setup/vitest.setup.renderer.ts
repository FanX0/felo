import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import { createMockElectronApi } from './mocks/electronIpc.mock'
import { setupWebAudioGlobals } from './mocks/webAudio.mock'
import { setupWebRTCGlobals } from './mocks/webrtc.mock'

setupWebAudioGlobals()
setupWebRTCGlobals()

const mockApi = createMockElectronApi()

// Attach to global window
Object.defineProperty(window, 'api', {
  value: mockApi,
  writable: true
})

Object.defineProperty(window, 'electron', {
  value: {
    ipcRenderer: {
      on: vi.fn().mockReturnValue(() => {}),
      removeListener: vi.fn(),
      send: vi.fn(),
      invoke: vi.fn()
    }
  },
  writable: true
})

// MatchMedia mock
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
})

// ResizeObserver mock
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
} as any

// IntersectionObserver mock
global.IntersectionObserver = class IntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
} as any

// URL object URL mocks
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = vi.fn(() => 'blob:mock-url')
  URL.revokeObjectURL = vi.fn()
}
