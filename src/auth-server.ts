#!/usr/bin/env node
/**
 * Servidor OAuth temporário para autenticação com YouTube.
 * Rode uma vez para gerar o token, depois pode parar.
 *
 * Uso: pnpm auth
 */
import { createServer } from 'http'
import { google } from 'googleapis'
import { writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

const CLIENT_ID     = process.env['YOUTUBE_CLIENT_ID']!
const CLIENT_SECRET = process.env['YOUTUBE_CLIENT_SECRET']!
const REDIRECT_URI  = process.env['YOUTUBE_REDIRECT_URI'] ?? 'http://localhost:4000/oauth/callback'
const TOKEN_PATH    = './tokens/youtube.token.json'

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
})

console.log('\n🔐 tubemind-secure-mcp — Autenticação YouTube\n')
console.log('Abra essa URL no navegador:\n')
console.log(authUrl)
console.log('\nAguardando callback em http://localhost:4000 ...\n')

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:4000`)

  if (!url.pathname.startsWith('/oauth/callback')) {
    res.writeHead(404)
    res.end('Not found')
    return
  }

  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<h2>❌ Erro: ${error}</h2>`)
    server.close()
    return
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h2>❌ Código de autorização não encontrado</h2>')
    server.close()
    return
  }

  try {
    const { tokens } = await oauth2Client.getToken(code)

    // Salva token em arquivo (criptografia aplicada pelo crypto.service em prod)
    await mkdir(dirname(TOKEN_PATH), { recursive: true })
    await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf-8')

    console.log('✅ Token salvo em:', TOKEN_PATH)
    console.log('🚀 Autenticação concluída! Pode fechar o navegador e parar esse servidor.\n')

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`
      <html>
        <body style="font-family:sans-serif;text-align:center;padding:60px;background:#0f0f0f;color:#fff">
          <h1>✅ Autenticado com sucesso!</h1>
          <p>O token foi salvo. Pode fechar esta aba.</p>
          <p style="color:#aaa;font-size:14px">tubemind-secure-mcp</p>
        </body>
      </html>
    `)

    server.close()
  } catch (err) {
    console.error('❌ Erro ao obter token:', err)
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<h2>❌ Erro ao obter token. Veja o console.</h2>')
    server.close()
  }
})

server.listen(4000)
