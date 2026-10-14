import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'os'

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    const list = interfaces[name] || []
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (
          !name.toLowerCase().includes('virtual') &&
          !name.toLowerCase().includes('pseudo') &&
          !name.toLowerCase().includes('loopback')
        ) {
          return iface.address
        }
      }
    }
  }
  return '127.0.0.1'
}

test('getLocalIpAddress resolves a valid local network address', () => {
  const ip = getLocalIpAddress()
  assert.ok(typeof ip === 'string')
  assert.ok(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip))
  console.log(`Discovered local IP for phone pairing: ${ip}`)
})
