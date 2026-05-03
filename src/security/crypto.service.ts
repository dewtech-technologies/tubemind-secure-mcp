import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

// A02 — AES-256-GCM para armazenamento seguro de tokens OAuth

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const TAG_LENGTH = 16
const KEY_LENGTH = 32

function getDerivedKey(): Buffer {
  const rawKey = process.env['TOKEN_ENCRYPTION_KEY']
  if (!rawKey || rawKey.length < 32) {
    throw new Error('[crypto] TOKEN_ENCRYPTION_KEY ausente ou muito curta. Gere com: openssl rand -hex 32')
  }
  // Deriva chave de 256 bits a partir do segredo configurado
  return scryptSync(rawKey, 'tubemind-salt-v1', KEY_LENGTH)
}

export function encrypt(plaintext: string): string {
  const key = getDerivedKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ])

  const tag = cipher.getAuthTag()

  // Formato: iv(hex):tag(hex):encrypted(hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) {
    throw new Error('[crypto] Formato de token inválido')
  }

  const [ivHex, tagHex, encryptedHex] = parts as [string, string, string]
  const key = getDerivedKey()
  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  return decipher.update(encrypted).toString('utf-8') + decipher.final('utf-8')
}
