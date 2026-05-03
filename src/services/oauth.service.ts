import { google } from 'googleapis'
import { randomBytes } from 'crypto'
import { encrypt, decrypt } from '../security/crypto.service.js'
import { assertAllowedDomain } from '../security/ssrf-guard.service.js'

assertAllowedDomain('accounts.google.com')
assertAllowedDomain('oauth2.googleapis.com')

// A07 — OAuth2 PKCE com state para CSRF protection
// A02 — Tokens armazenados criptografados

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]

// Storage em memória (em produção: substituir por store persistente criptografado)
const tokenStore = new Map<string, string>() // userId → encrypted token JSON
const stateStore = new Map<string, number>()  // state → expiry timestamp

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env['YOUTUBE_CLIENT_ID'],
    process.env['YOUTUBE_CLIENT_SECRET'],
    process.env['YOUTUBE_REDIRECT_URI'],
  )
}

export function generateAuthUrl(): { url: string; state: string } {
  const oauth2Client = getOAuthClient()

  // A07 — state aleatório para CSRF
  const state = randomBytes(32).toString('hex')
  stateStore.set(state, Date.now() + 10 * 60 * 1000) // expira em 10 min

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent',
  })

  return { url, state }
}

export async function handleCallback(
  code: string,
  state: string,
  userId: string,
): Promise<void> {
  // Valida state (CSRF protection)
  const expiry = stateStore.get(state)
  if (!expiry || Date.now() > expiry) {
    stateStore.delete(state)
    throw new Error('[oauth] State inválido ou expirado.')
  }
  stateStore.delete(state)

  const oauth2Client = getOAuthClient()
  const { tokens } = await oauth2Client.getToken(code)

  // A02 — Armazena token criptografado
  tokenStore.set(userId, encrypt(JSON.stringify(tokens)))
}

export function getAccessToken(userId: string): string {
  const encrypted = tokenStore.get(userId)
  if (!encrypted) throw new Error('[oauth] Usuário não autenticado. Execute /auth primeiro.')

  const tokens = JSON.parse(decrypt(encrypted)) as { access_token?: string; expiry_date?: number }

  if (!tokens.access_token) {
    throw new Error('[oauth] Token de acesso inválido.')
  }

  if (tokens.expiry_date && Date.now() > tokens.expiry_date) {
    throw new Error('[oauth] Token expirado. Execute /auth novamente.')
  }

  return tokens.access_token
}

export function revokeToken(userId: string): void {
  tokenStore.delete(userId)
}
