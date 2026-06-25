import { describe, it, expect } from '../test-utils/vitest-compat.ts'
import { evalPromptCandidate, autoActivatePrompt, rollbackPrompt, autoRollbackIfDegraded, monitorAiPromptOutcome, REQUIRED_PROMPT_TOKENS } from './prompt-governance.ts'

// 체이너블 mock — insert/update 기록, select.maybeSingle/리스트 반환
function mockDb(opts: { current?: Record<string, unknown>; list?: Record<string, unknown[]> } = {}) {
  const log = { inserts: [] as Array<{ table: string; row: Record<string, unknown> }>, updates: [] as Array<{ table: string; row: Record<string, unknown> }> }
  function chain(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj: any = {
      select: () => obj,
      insert: (row: Record<string, unknown>) => { log.inserts.push({ table, row }); return obj },
      update: (row: Record<string, unknown>) => { log.updates.push({ table, row }); return obj },
      eq: () => obj, in: () => obj, order: () => obj, limit: () => obj,
      maybeSingle: () => Promise.resolve({ data: opts.current?.[table] ?? null, error: null }),
      then: (res: (v: unknown) => void) => res({ data: opts.list?.[table] ?? null, error: null }),
    }
    return obj
  }
  return { db: { from: (t: string) => chain(t) }, log }
}

const GOOD = `모델 추출: model_name, memory, unit_price_usd, supplier, term, quantity{resp_qty} 를 JSON으로`
const BAD = `model_name, unit_price_usd, supplier, term 만 추출` // quantity·resp_qty 누락

describe('축6 자동활성 eval 게이트', () => {
  it('필수 필드 다 있으면 통과', () => {
    expect(evalPromptCandidate(GOOD).ok).toBe(true)
  })
  it('quantity/resp_qty 누락 후보는 차단(missing 보고)', () => {
    const ev = evalPromptCandidate(BAD)
    expect(ev.ok).toBe(false)
    expect(ev.missing).toContain('quantity')
    expect(ev.missing).toContain('resp_qty')
  })
  it('REQUIRED 토큰에 재고 회귀 가드 포함', () => {
    expect(REQUIRED_PROMPT_TOKENS).toContain('resp_qty')
  })
})

describe('축6 AI 자가갱신 자동반영(D3)', () => {
  it('좋은 후보 → 자동 active 전환 + auto_activated 감사기록', async () => {
    const { db, log } = mockDb({ current: { ai_prompts: { content: 'old prompt' } } })
    const r = await autoActivatePrompt(db, { promptKey: 'gpu.quote-extract', newContent: GOOD, reason: '약정 필드 누락', trigger: 'empty_extraction', nowIso: '2026-06-05T00:00:00Z' })
    expect(r.activated).toBe(true)
    expect(log.inserts.some((i) => i.table === 'ai_prompts' && i.row.active === true && i.row.source === 'ai')).toBe(true)
    expect(log.inserts.some((i) => i.table === 'ai_prompt_revisions' && i.row.event === 'auto_activated')).toBe(true)
    expect(log.inserts.some((i) => i.table === 'gpu_audit_logs' && i.row.action_type === 'ai_prompt_auto_activated')).toBe(true)
  })

  it('나쁜 후보 → 자동활성 차단(held) + held 감사(왜=missing)', async () => {
    const { db, log } = mockDb({ current: { ai_prompts: { content: 'old' } } })
    const r = await autoActivatePrompt(db, { promptKey: 'gpu.quote-extract', newContent: BAD, reason: '시도', trigger: 'low_confidence', nowIso: '2026-06-05T00:00:00Z' })
    expect(r.activated).toBe(false)
    expect(r.missing).toContain('quantity')
    expect(log.inserts.some((i) => i.table === 'ai_prompts' && i.row.active === false)).toBe(true)
    expect(log.inserts.some((i) => i.table === 'ai_prompt_revisions' && i.row.event === 'held')).toBe(true)
  })
})

describe('축6 롤백(사람·자동)', () => {
  it('수동 롤백 → 지정 버전 복원 active + rolled_back 감사', async () => {
    const { db, log } = mockDb({ current: { ai_prompts: { content: 'bad active' } } })
    const r = await rollbackPrompt(db, { promptKey: 'gpu.quote-extract', toContent: GOOD, toVersion: 'v2.0', by: 'admin@x', auto: false, reason: '품질 저하', nowIso: '2026-06-05T00:00:00Z' })
    expect(r.ok).toBe(true)
    expect(log.inserts.some((i) => i.table === 'ai_prompts' && i.row.active === true && i.row.content === GOOD)).toBe(true)
    expect(log.inserts.some((i) => i.table === 'gpu_audit_logs' && i.row.action_type === 'ai_prompt_rolled_back')).toBe(true)
  })

  it('자동롤백: degraded면 직전 활성본으로 복원(auto_rolled_back)', async () => {
    const { db, log } = mockDb({
      current: { ai_prompts: { content: 'current bad' } },
      list: { ai_prompt_revisions: [{ version: 'ai-new', content: 'bad', event: 'auto_activated' }, { version: 'v2.0', content: GOOD, event: 'auto_activated' }] },
    })
    const r = await autoRollbackIfDegraded(db, { promptKey: 'gpu.quote-extract', degraded: true, nowIso: '2026-06-05T00:00:00Z' })
    expect(r.rolledBack).toBe(true)
    expect(r.toVersion).toBe('v2.0')
    expect(log.inserts.some((i) => i.table === 'gpu_audit_logs' && i.row.action_type === 'ai_prompt_auto_rolled_back')).toBe(true)
  })

  it('degraded 아니면 롤백 안 함', async () => {
    const { db } = mockDb()
    const r = await autoRollbackIfDegraded(db, { promptKey: 'gpu.quote-extract', degraded: false, nowIso: '2026-06-05T00:00:00Z' })
    expect(r.rolledBack).toBe(false)
  })
})

describe('축6 라이브 모니터(자동롤백 배선)', () => {
  it('추출 성공(ok=true)이면 아무것도 안 함', async () => {
    const { db } = mockDb()
    const r = await monitorAiPromptOutcome(db, { promptKey: 'gpu.auto-synth.x', ok: true, nowIso: '2026-06-05T00:00:00Z' })
    expect(r.action).toBe('none')
  })

  it('실패 + 직전본 있으면 자동 롤백', async () => {
    const { db } = mockDb({
      current: { ai_prompts: { content: 'bad synth', version: 'ai-x' } },
      list: { ai_prompt_revisions: [{ version: 'ai-x', content: 'bad', event: 'auto_activated' }, { version: 'v1', content: GOOD, event: 'auto_activated' }] },
    })
    const r = await monitorAiPromptOutcome(db, { promptKey: 'gpu.quote-extract', ok: false, nowIso: '2026-06-05T00:00:00Z' })
    expect(r.action).toBe('rolled_back')
  })

  it('실패 + 직전본 없으면(신규 자가합성) 비활성 + 감사', async () => {
    const { db, log } = mockDb({ current: { ai_prompts: { content: 'bad synth', version: 'ai-new' } }, list: { ai_prompt_revisions: [] } })
    const r = await monitorAiPromptOutcome(db, { promptKey: 'gpu.auto-synth.x', ok: false, nowIso: '2026-06-05T00:00:00Z' })
    expect(r.action).toBe('deactivated')
    expect(log.updates.some((u) => u.table === 'ai_prompts' && u.row.active === false)).toBe(true)
    expect(log.inserts.some((i) => i.table === 'ai_prompt_revisions' && i.row.event === 'auto_rolled_back')).toBe(true)
  })
})
