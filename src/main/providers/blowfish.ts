import { Blowfish } from 'egoroof-blowfish'

const DEFAULT_IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])

/**
 * High-performance, zero-native-dependency Blowfish CBC decrypter for Deezer audio streams.
 * Resolves OpenSSL 3.0+ deprecation of legacy 'bf-cbc' cipher in Node.js/Electron.
 */
export class BlowfishCBC {
  private bf: any

  constructor(key: Buffer | Uint8Array) {
    this.bf = new Blowfish(key, Blowfish.MODE.CBC, Blowfish.PADDING.NULL)
  }

  /**
   * Decrypts an encrypted chunk using Blowfish CBC mode.
   * Deezer encrypts 2048-byte chunks where IV is reset to [0,1,2,3,4,5,6,7] per chunk.
   */
  decryptChunk(chunk: Buffer, iv: Buffer = DEFAULT_IV): Buffer {
    if (chunk.length === 0) return Buffer.alloc(0)
    if (chunk.length % 8 !== 0) {
      throw new Error(`Blowfish CBC chunk length must be divisible by 8, received ${chunk.length}`)
    }
    this.bf.setIv(iv)
    const decoded = this.bf.decode(chunk, Blowfish.TYPE.UINT8_ARRAY)
    return Buffer.from(decoded)
  }
}
