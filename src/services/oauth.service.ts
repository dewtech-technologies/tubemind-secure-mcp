import { google } from 'googleapis'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { assertAllowedDomain } from '../security/ssrf-guard.service.js'

assertAllowedDomain('accounts.google.com')
assertAllowedDomain('oauth2.googleapis.com')

// Caminho absoluto relativo à raiz do projeto (2 níveis acima de src/services/)
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TOKEN_PATH = resolve(PROJECT_ROOT, 'tokens', 'youtube.token.json')

interface TokenData {
  access_token?: string | null
  refresh_token?: string | null
  expiry_date?: number | null
  token_type?: string | null
  scope?: string
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env['YOUTUBE_CLIENT_ID'],
    process.env['YOUTUBE_CLIENT_SECRET'],
    process.env['YOUTUBE_REDIRECT_URI'],
  )
}

async function loadTokens(): Promise<TokenData> {
  try {
    const raw = await readFile(TOKEN_PATH, 'utf-8')
    return JSON.parse(raw) as TokenData
  } catch {
    throw new Error(
      '[oauth] Token não encontrado. Execute "pnpm auth" para autenticar primeiro.',
    )
  }
}

async function saveTokens(tokens: TokenData): Promise<void> {
  await mkdir(dirname(TOKEN_PATH), { recursive: true })
  await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8')
}

export async function getAccessToken(): Promise<string> {
  const tokens = await loadTokens()

  if (!tokens.access_token) {
    throw new Error('[oauth] Token de acesso inválido. Execute "pnpm auth" novamente.')
  }

  // Token ainda válido (com 5 min de margem)
  if (tokens.expiry_date && Date.now() < tokens.expiry_date - 300_000) {
    return tokens.access_token as string
  }

  // Token expirado — tenta renovar com refresh_token
  if (!tokens.refresh_token) {
    throw new Error('[oauth] Refresh token não encontrado. Execute "pnpm auth" novamente.')
  }

  console.error('[oauth] Token expirado, renovando...')

  const oauth2Client = getOAuthClient()
  oauth2Client.setCredentials(tokens)

  const { credentials } = await oauth2Client.refreshAccessToken()

  // Salva tokens atualizados
  const updated: TokenData = { ...tokens, ...credentials }
  await saveTokens(updated)

  console.error('[oauth] Token renovado com sucesso ✅')

  return updated.access_token!
}

export async function revokeToken(): Promise<void> {
  const tokens = await loadTokens()
  if (tokens.access_token) {
    const oauth2Client = getOAuthClient()
    await oauth2Client.revokeToken(tokens.access_token)
  }
  await saveTokens({})
}
