// A10 — SSRF Guard: whitelist explícita de domínios permitidos

const ALLOWED_DOMAINS = new Set([
  'www.googleapis.com',
  'youtube.googleapis.com',
  'accounts.google.com',
  'oauth2.googleapis.com',
  'youtubeanalytics.googleapis.com',
])

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

  if (!ALLOWED_DOMAINS.has(host)) {
    throw new SsrfGuardError(host)
  }

  return parsed
}

export function assertAllowedDomain(domain: string): void {
  if (!ALLOWED_DOMAINS.has(domain)) {
    throw new SsrfGuardError(domain)
  }
}
