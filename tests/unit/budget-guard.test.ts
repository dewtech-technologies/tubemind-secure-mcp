import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  assertBudgetAvailable,
  getCurrentSpent,
  BudgetExceededError,
} from '../../src/security/budget-guard.service.js'
import { recordQuota } from '../../src/services/quota.service.js'
import { resetDbForTesting } from '../../src/services/db.service.js'
import { sha256 } from '../../src/utils/hash.js'

describe('budget-guard — task-006 (RS-2.9 / RS-3.8 / RS-4.5)', () => {
  let tmpDir: string
  let savedPath: string | undefined
  let savedEnabled: string | undefined
  let savedVision: string | undefined
  const tokenHash = sha256('budget-test')

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tubemind-budget-test-'))
    savedPath = process.env['TUBEMIND_CACHE_PATH']
    savedEnabled = process.env['TUBEMIND_CACHE_ENABLED']
    savedVision = process.env['VISION_DAILY_BUDGET_USD']
    process.env['TUBEMIND_CACHE_PATH'] = join(tmpDir, 'cache.db')
    process.env['TUBEMIND_CACHE_ENABLED'] = 'true'
    resetDbForTesting()
  })

  afterEach(() => {
    resetDbForTesting()
    if (savedPath !== undefined) process.env['TUBEMIND_CACHE_PATH'] = savedPath
    else delete process.env['TUBEMIND_CACHE_PATH']
    if (savedEnabled !== undefined) process.env['TUBEMIND_CACHE_ENABLED'] = savedEnabled
    else delete process.env['TUBEMIND_CACHE_ENABLED']
    if (savedVision !== undefined) process.env['VISION_DAILY_BUDGET_USD'] = savedVision
    else delete process.env['VISION_DAILY_BUDGET_USD']
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should_return_zero_spent_when_no_anthropic_calls', () => {
    expect(getCurrentSpent('vision', tokenHash)).toBe(0)
  })

  it('should_sum_anthropic_costs_in_today_bucket', () => {
    recordQuota('anthropic:vision', tokenHash, 'tool-x', { costUsd: 0.01 })
    recordQuota('anthropic:vision', tokenHash, 'tool-y', { costUsd: 0.02 })
    expect(getCurrentSpent('vision', tokenHash)).toBeCloseTo(0.03, 6)
  })

  it('should_pass_assert_when_proposed_within_cap', () => {
    process.env['VISION_DAILY_BUDGET_USD'] = '5.00'
    expect(() => assertBudgetAvailable('vision', 0.10, tokenHash)).not.toThrow()
  })

  it('should_throw_BudgetExceededError_when_proposed_exceeds_cap', () => {
    process.env['VISION_DAILY_BUDGET_USD'] = '0.05'
    recordQuota('anthropic:vision', tokenHash, 'x', { costUsd: 0.04 })

    expect(() => assertBudgetAvailable('vision', 0.02, tokenHash)).toThrow(BudgetExceededError)
  })

  it('should_isolate_budget_per_token', () => {
    process.env['VISION_DAILY_BUDGET_USD'] = '1.00'
    const tokenA = sha256('user-A')
    const tokenB = sha256('user-B')

    recordQuota('anthropic:vision', tokenA, 'x', { costUsd: 0.99 })
    // Token B ainda tem todo o cap disponível
    expect(() => assertBudgetAvailable('vision', 0.50, tokenB)).not.toThrow()
    // Token A já esgotou
    expect(() => assertBudgetAvailable('vision', 0.02, tokenA)).toThrow(BudgetExceededError)
  })
})
