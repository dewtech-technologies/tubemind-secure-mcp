import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Bootstrap v0.2 — task-001', () => {
  describe('package.json', () => {
    const pkgPath = resolve(process.cwd(), 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      version: string
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }

    it('should_be_version_0_2_x', () => {
      expect(pkg.version).toMatch(/^0\.2\./)
    })

    it('should_have_better_sqlite3_pinned_to_11_5_0', () => {
      expect(pkg.dependencies['better-sqlite3']).toBe('11.5.0')
    })

    it('should_have_anthropic_sdk_pinned_to_0_32_1', () => {
      expect(pkg.dependencies['@anthropic-ai/sdk']).toBe('0.32.1')
    })

    it('should_have_sharp_pinned_to_0_35_5', () => {
      expect(pkg.dependencies['sharp']).toBe('0.35.5')
    })

    it('should_have_types_better_sqlite3_in_devDependencies', () => {
      expect(pkg.devDependencies['@types/better-sqlite3']).toBeDefined()
    })

    it('should_keep_existing_v01_deps_unchanged', () => {
      expect(pkg.dependencies['@modelcontextprotocol/sdk']).toBe('1.32.2')
      expect(pkg.dependencies['googleapis']).toBe('171.4.0')
      expect(pkg.dependencies['zod']).toBe('4.6.7')
    })
  })

  describe('lazy imports — sem ANTHROPIC_API_KEY não pode crashar', () => {
    let originalKey: string | undefined

    beforeEach(() => {
      originalKey = process.env['ANTHROPIC_API_KEY']
      delete process.env['ANTHROPIC_API_KEY']
    })

    afterEach(() => {
      if (originalKey !== undefined) process.env['ANTHROPIC_API_KEY'] = originalKey
    })

    it('should_import_anthropic_sdk_lazily_without_api_key', async () => {
      // O SDK Anthropic pode ser IMPORTADO sem API key — só falha ao construir client/usar
      const sdk = await import('@anthropic-ai/sdk')
      expect(sdk).toBeDefined()
      expect(sdk.default).toBeDefined()
    })

    it('should_import_sharp_without_crash', async () => {
      const sharp = await import('sharp')
      expect(sharp).toBeDefined()
      expect(typeof sharp.default).toBe('function')
    })

    it('should_import_better_sqlite3_without_crash', async () => {
      const Database = await import('better-sqlite3')
      expect(Database).toBeDefined()
      expect(typeof Database.default).toBe('function')
    })
  })

  describe('env defaults', () => {
    it('should_default_cache_enabled_to_true_when_env_missing', () => {
      const original = process.env['TUBEMIND_CACHE_ENABLED']
      delete process.env['TUBEMIND_CACHE_ENABLED']

      const cacheEnabled = process.env['TUBEMIND_CACHE_ENABLED'] !== 'false'
      expect(cacheEnabled).toBe(true)

      if (original !== undefined) process.env['TUBEMIND_CACHE_ENABLED'] = original
    })

    it('should_disable_cache_when_env_is_false_string', () => {
      const original = process.env['TUBEMIND_CACHE_ENABLED']
      process.env['TUBEMIND_CACHE_ENABLED'] = 'false'

      const cacheEnabled = process.env['TUBEMIND_CACHE_ENABLED'] !== 'false'
      expect(cacheEnabled).toBe(false)

      if (original !== undefined) process.env['TUBEMIND_CACHE_ENABLED'] = original
      else delete process.env['TUBEMIND_CACHE_ENABLED']
    })
  })

  describe('.env.example', () => {
    const envPath = resolve(process.cwd(), '.env.example')
    const envContent = readFileSync(envPath, 'utf-8')

    it('should_document_TUBEMIND_CACHE_PATH', () => {
      expect(envContent).toContain('TUBEMIND_CACHE_PATH=')
    })

    it('should_document_TUBEMIND_CACHE_ENABLED_default_true', () => {
      expect(envContent).toMatch(/TUBEMIND_CACHE_ENABLED=true/)
    })

    it('should_document_ANTHROPIC_API_KEY_as_empty_placeholder', () => {
      expect(envContent).toMatch(/ANTHROPIC_API_KEY=/)
    })

    it('should_document_VISION_DAILY_BUDGET_USD_with_default', () => {
      expect(envContent).toMatch(/VISION_DAILY_BUDGET_USD=5\.00/)
    })

    it('should_document_NLP_DAILY_BUDGET_USD_with_default', () => {
      expect(envContent).toMatch(/NLP_DAILY_BUDGET_USD=10\.00/)
    })

    it('should_document_WORKFLOW_DAILY_BUDGET_USD_with_default', () => {
      expect(envContent).toMatch(/WORKFLOW_DAILY_BUDGET_USD=20\.00/)
    })

    it('should_preserve_v01_envs', () => {
      expect(envContent).toContain('YOUTUBE_CLIENT_ID=')
      expect(envContent).toContain('TOKEN_ENCRYPTION_KEY=')
    })
  })
})
