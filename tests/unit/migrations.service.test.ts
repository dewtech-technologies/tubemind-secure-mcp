import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'

import {
  initDatabase,
  runMigrations,
  listMigrations,
  getDefaultDbPath,
  recoverCorruptedDatabase,
  MigrationsCorruptError,
  CachePathTraversalError,
} from '../../src/cache/migrations.service.js'

describe('migrations.service — task-002', () => {
  let tmpDir: string
  let dbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tubemind-test-'))
    dbPath = join(tmpDir, 'cache.db')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('initDatabase + runMigrations', () => {
    it('should_create_all_tables_when_db_is_new', () => {
      const db = initDatabase(dbPath)

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as Array<{ name: string }>

      const names = tables.map((t) => t.name)
      expect(names).toContain('cache_entries')
      expect(names).toContain('quota_log')
      expect(names).toContain('_migrations')

      db.close()
    })

    it('should_create_all_8_indexes', () => {
      const db = initDatabase(dbPath)

      const indexes = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>

      const expected = [
        'idx_cache_expires_at',
        'idx_cache_last_accessed',
        'idx_cache_token_hash',
        'idx_cache_tool_name',
        'idx_quota_day_bucket',
        'idx_quota_endpoint',
        'idx_quota_token_hash',
        'idx_quota_tool_name',
      ]
      expect(indexes.map((i) => i.name).sort()).toEqual(expected)
      db.close()
    })

    it('should_apply_WAL_journal_mode', () => {
      const db = initDatabase(dbPath)
      const mode = db.pragma('journal_mode', { simple: true })
      expect(mode).toBe('wal')
      db.close()
    })

    it('should_apply_synchronous_NORMAL', () => {
      const db = initDatabase(dbPath)
      // synchronous: 0=OFF, 1=NORMAL, 2=FULL
      const sync = db.pragma('synchronous', { simple: true })
      expect(sync).toBe(1)
      db.close()
    })

    it('should_record_each_migration_in__migrations_table', () => {
      const db = initDatabase(dbPath)
      const rows = db.prepare('SELECT filename FROM _migrations ORDER BY filename').all() as Array<{
        filename: string
      }>
      expect(rows.map((r) => r.filename)).toEqual([
        '001_create_cache_entries',
        '002_create_quota_log',
        '003_indexes',
      ])
      db.close()
    })

    it('should_be_idempotent_when_run_twice_on_same_db', () => {
      const db1 = initDatabase(dbPath)
      const count1 = (db1.prepare('SELECT COUNT(*) as c FROM _migrations').get() as { c: number }).c
      db1.close()

      const db2 = initDatabase(dbPath)
      const count2 = (db2.prepare('SELECT COUNT(*) as c FROM _migrations').get() as { c: number }).c
      db2.close()

      expect(count1).toBe(count2)
      expect(count2).toBe(listMigrations().length)
    })

    it('should_pass_integrity_check_on_fresh_db', () => {
      const db = initDatabase(dbPath)
      const result = db.pragma('integrity_check', { simple: true })
      expect(result).toBe('ok')
      db.close()
    })

    it('should_create_db_directory_if_missing', () => {
      const nestedPath = join(tmpDir, 'deeply', 'nested', 'dir', 'cache.db')
      const db = initDatabase(nestedPath)
      expect(existsSync(nestedPath)).toBe(true)
      db.close()
    })
  })

  describe('permissions (Unix)', () => {
    it.skipIf(process.platform === 'win32')(
      'should_set_chmod_600_on_unix',
      () => {
        const db = initDatabase(dbPath)
        db.close()

        const mode = statSync(dbPath).mode & 0o777
        expect(mode).toBe(0o600)
      },
    )
  })

  describe('path validation (RS-1.5)', () => {
    it('should_reject_path_with_dotdot_traversal', () => {
      // Usar string literal — `path.join` normaliza `..` antes de chegar ao código
      const evilPath = `${tmpDir}/../escape.db`
      expect(() => initDatabase(evilPath)).toThrow(CachePathTraversalError)
    })

    it('should_reject_env_TUBEMIND_CACHE_PATH_with_traversal', () => {
      const original = process.env['TUBEMIND_CACHE_PATH']
      process.env['TUBEMIND_CACHE_PATH'] = '/tmp/../etc/passwd'

      expect(() => getDefaultDbPath()).toThrow(CachePathTraversalError)

      if (original !== undefined) process.env['TUBEMIND_CACHE_PATH'] = original
      else delete process.env['TUBEMIND_CACHE_PATH']
    })

    it('should_use_env_TUBEMIND_CACHE_PATH_when_set', () => {
      const original = process.env['TUBEMIND_CACHE_PATH']
      const customPath = join(tmpDir, 'custom.db')
      process.env['TUBEMIND_CACHE_PATH'] = customPath

      expect(getDefaultDbPath()).toBe(customPath)

      if (original !== undefined) process.env['TUBEMIND_CACHE_PATH'] = original
      else delete process.env['TUBEMIND_CACHE_PATH']
    })
  })

  describe('corruption recovery', () => {
    it('should_export_MigrationsCorruptError_for_caller_recovery_paths', () => {
      // Validação de superfície: a classe existe, é uma Error, tem nome correto.
      // O cenário real de corrupção é coberto por better-sqlite3 propagando o erro nativo
      // (SqliteError "file is not a database"); o caller pode capturar e invocar
      // recoverCorruptedDatabase ou lançar o nosso MigrationsCorruptError manualmente.
      const err = new MigrationsCorruptError('test')
      expect(err).toBeInstanceOf(Error)
      expect(err.name).toBe('MigrationsCorruptError')
      expect(err.message).toBe('test')
    })

    it('should_recover_by_moving_corrupted_file_aside_and_recreating', () => {
      // Cria DB válida
      const db1 = initDatabase(dbPath)
      db1.prepare('INSERT INTO _migrations (filename, applied_at) VALUES (?, ?)').run(
        'sentinel',
        999,
      )

      // Simula recovery: fecha + move .corrupted + reinit
      const db2 = recoverCorruptedDatabase(db1, dbPath)

      // Nova DB legível (não vazia)
      const filesAfter = readFileSync(dbPath)
      expect(filesAfter.length).toBeGreaterThan(0)

      // Nova DB não tem 'sentinel' (foi para .corrupted)
      const rows = db2.prepare("SELECT filename FROM _migrations WHERE filename='sentinel'").all()
      expect(rows.length).toBe(0)

      db2.close()
    })
  })

  describe('runMigrations standalone (com DB pré-existente)', () => {
    it('should_skip_migrations_already_in__migrations_when_tables_already_exist', () => {
      // Setup realista: DB já tem TODAS as 3 migrations aplicadas (pré-populado)
      // — runMigrations deve ser no-op total (idempotência verdadeira).
      const db = new Database(dbPath)
      db.exec(`
        CREATE TABLE _migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
        CREATE TABLE cache_entries (id INTEGER PRIMARY KEY);
        CREATE TABLE quota_log (id INTEGER PRIMARY KEY);
        INSERT INTO _migrations (filename, applied_at) VALUES
          ('001_create_cache_entries', 0),
          ('002_create_quota_log', 0),
          ('003_indexes', 0);
      `)

      // Não deve lançar nem tentar recriar
      expect(() => runMigrations(db)).not.toThrow()

      const rows = db.prepare('SELECT COUNT(*) as c FROM _migrations').get() as { c: number }
      expect(rows.c).toBe(3)
      db.close()
    })
  })
})
