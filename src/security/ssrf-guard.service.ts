// A10 — SSRF Guard: whitelist explícita de domínios permitidos

const ALLOWED_DOMAINS = new Set([
  // Google / YouTube APIs (v0.1)
  'www.googleapis.com',
  'youtube.googleapis.com',
  'accounts.google.com',
  'oauth2.googleapis.com',
  'youtubeanalytics.googleapis.com',
  // YouTube thumbnail CDN (v0.2 Camada 2 — RS-2.1)
  'i.ytimg.com',
  'i9.ytimg.com',
  'yt3.ggpht.com',
  'lh3.googleusercontent.com',
  // Anthropic Claude API (v0.2 Camadas 2/3/4 — Vision + NLP + Pipeline)
  'api.anthropic.com',
])

/**
 * Sufixos permitidos para domínios YouTube/Google que servem subdomínios dinâmicos.
 * Ex: yt3.ggpht.com tem variantes regionais; lh3.googleusercontent.com tem hashes.
 */
const ALLOWED_DOMAIN_SUFFIXES = ['.ytimg.com', '.ggpht.com', '.googleusercontent.com']

export class SsrfGuardError extends Error {
  constructor(domain: string) {
    super(`[SSRF] Domínio não permitido: ${domain}`)
    this.name = 'SsrfGuardError'
  }
}

export function validateUrl(rawUrl: string): URL {
  let parsed: URL

  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new SsrfGuardError('URL inválida')
  }

  // Força HTTPS
  if (parsed.protocol !== 'https:') {
    throw new SsrfGuardError(`Protocolo não permitido: ${parsed.protocol}`)
  }

  // Bloqueia IPs privados / loopback (SSRF interno)
  const host = parsed.hostname
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host.startsWith('10.') ||
    host.startsWith('172.16.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||   // link-local
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new SsrfGuardError(`IP/host privado bloqueado: ${host}`)
  }

  if (!isAllowedHost(host)) {
    throw new SsrfGuardError(host)
  }

  return parsed
}

export function assertAllowedDomain(domain: string): void {
  if (!isAllowedHost(domain)) {
    throw new SsrfGuardError(domain)
  }
}

function isAllowedHost(host: string): boolean {
  if (ALLOWED_DOMAINS.has(host)) return true
  return ALLOWED_DOMAIN_SUFFIXES.some((suffix) => host.endsWith(suffix))
}
