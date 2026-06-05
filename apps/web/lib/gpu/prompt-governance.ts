// 축6: AI 프롬프트 자가갱신 자동반영 + 감사 + 롤백. D3: AI는 자동 active(사람 승격 아님), 사람은 롤백.
// 모든 변경은 ai_prompt_revisions(append-only 스냅샷) + gpu_audit_logs(왜·어떻게)에 기록.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

// 자동활성 前 게이트(결정적·무료): 후보 프롬프트가 필수 추출 지시를 유지하는지.
// 빠뜨리면 자동활성 금지 → 재고 증발 같은 회귀를 자동반영 단계에서 차단.
export const REQUIRED_PROMPT_TOKENS = ['model_name', 'unit_price_usd', 'supplier', 'quantity', 'resp_qty', 'term']

export interface PromptEval { ok: boolean; missing: string[] }
export function evalPromptCandidate(content: string): PromptEval {
  const missing = REQUIRED_PROMPT_TOKENS.filter((t) => !content.includes(t))
  return { ok: missing.length === 0, missing }
}

function shortId(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36).slice(0, 6)
}

function diffSummary(before: string, after: string): string {
  const b = before.split('\n'), a = after.split('\n')
  const added = a.filter((l) => !b.includes(l)).length
  const removed = b.filter((l) => !a.includes(l)).length
  return `+${added}줄 / -${removed}줄`
}

export type PromptEvent = 'auto_activated' | 'auto_rolled_back' | 'rolled_back' | 'edited' | 'held' | 'activated' | 'deactivated'

// 변경 1건 = 스냅샷(왜·어떻게) + 감사로그. 단일 기록 경로(재사용).
export async function recordRevision(
  db: Db,
  r: { promptKey: string; version: string; content: string; source: 'ai' | 'human'; event: PromptEvent; reason?: string; trigger?: string; createdBy?: string; prevContent?: string; nowIso: string },
): Promise<void> {
  // M1(DC-REV): revision 스냅샷은 거버넌스 불변식 — 실패 시 throw(append-only 보장). audit는 보조라 silent 허용.
  const { error: revErr } = await db.from('ai_prompt_revisions').insert({
    prompt_key: r.promptKey, version: r.version, content: r.content,
    source: r.source, event: r.event, reason: r.reason ?? null, trigger: r.trigger ?? null,
    created_by: r.createdBy ?? 'system', created_at: r.nowIso,
  })
  if (revErr) throw new Error(`revision 기록 실패: ${revErr.message}`)
  await db.from('gpu_audit_logs').insert({
    actor: r.createdBy ?? (r.source === 'ai' ? 'ai' : 'system'),
    action_type: `ai_prompt_${r.event}`,
    detail: {
      prompt_key: r.promptKey, version: r.version, source: r.source,
      reason: r.reason ?? null, trigger: r.trigger ?? null,
      diff_summary: r.prevContent != null ? diffSummary(r.prevContent, r.content) : null,
    },
  })
}

// AI 자가갱신 자동반영(D3). eval 통과 → 즉시 active 전환 + auto_activated 감사. 미통과 → draft 보류(held) + 감사.
export async function autoActivatePrompt(
  db: Db,
  p: { promptKey: string; newContent: string; reason: string; trigger: string; modelHint?: string | null; nowIso: string },
): Promise<{ activated: boolean; missing?: string[] }> {
  const ev = evalPromptCandidate(p.newContent)
  const version = `ai-${shortId(p.newContent)}`

  // 직전 active content(diff·롤백 근거)
  const { data: cur } = await db.from('ai_prompts').select('content').eq('prompt_key', p.promptKey).eq('active', true).maybeSingle()
  const prevContent: string | undefined = cur?.content

  if (!ev.ok) {
    // 보류: draft(active=false) 저장 + held 감사 (자동활성 차단)
    const { data: existing } = await db.from('ai_prompts').select('id').eq('prompt_key', p.promptKey).eq('version', version).maybeSingle()
    if (existing?.id) await db.from('ai_prompts').update({ content: p.newContent, source: 'ai', updated_at: p.nowIso }).eq('id', existing.id)
    else await db.from('ai_prompts').insert({ prompt_key: p.promptKey, version, content: p.newContent, active: false, source: 'ai', updated_by: 'ai', updated_at: p.nowIso })
    await recordRevision(db, { promptKey: p.promptKey, version, content: p.newContent, source: 'ai', event: 'held', reason: `${p.reason} (보류: 필수필드 누락 ${ev.missing.join(',')})`, trigger: p.trigger, createdBy: 'ai', prevContent, nowIso: p.nowIso })
    return { activated: false, missing: ev.missing }
  }

  // 활성: 기존 active 비활성 → 신규 active(직전 버전은 revisions+비활성 행으로 보존, 롤백 가능)
  // H2(DC-REV): uq_ai_prompts_active_per_key 부분unique와 동시성 충돌 시 INSERT 실패 → 보류 처리(예외 전파 금지)
  await db.from('ai_prompts').update({ active: false, updated_at: p.nowIso }).eq('prompt_key', p.promptKey).eq('active', true)
  const { error: insErr } = await db.from('ai_prompts').insert({ prompt_key: p.promptKey, version, content: p.newContent, active: true, source: 'ai', model_hint: p.modelHint ?? null, updated_by: 'ai', updated_at: p.nowIso })
  if (insErr) return { activated: false, missing: [`동시성 충돌: ${insErr.message}`] }
  await recordRevision(db, { promptKey: p.promptKey, version, content: p.newContent, source: 'ai', event: 'auto_activated', reason: p.reason, trigger: p.trigger, createdBy: 'ai', prevContent, nowIso: p.nowIso })
  return { activated: true }
}

// 롤백: 지정 revision(또는 직전 활성본)의 content를 다시 active로 복원. 사람 수동 또는 자동.
export async function rollbackPrompt(
  db: Db,
  p: { promptKey: string; toContent: string; toVersion: string; by: string; auto: boolean; reason: string; nowIso: string },
): Promise<{ ok: boolean; error?: string }> {
  const { data: cur } = await db.from('ai_prompts').select('content').eq('prompt_key', p.promptKey).eq('active', true).maybeSingle()
  const prevContent: string | undefined = cur?.content
  const version = `rb-${shortId(p.toContent + p.nowIso)}`
  await db.from('ai_prompts').update({ active: false, updated_at: p.nowIso }).eq('prompt_key', p.promptKey).eq('active', true)
  const { error } = await db.from('ai_prompts').insert({ prompt_key: p.promptKey, version, content: p.toContent, active: true, source: 'human', updated_by: p.by, updated_at: p.nowIso })
  if (error) return { ok: false, error: error.message }
  await recordRevision(db, { promptKey: p.promptKey, version, content: p.toContent, source: 'human', event: p.auto ? 'auto_rolled_back' : 'rolled_back', reason: `${p.reason} (→ ${p.toVersion} 복원)`, trigger: p.auto ? 'live_degraded' : 'manual', createdBy: p.by, prevContent, nowIso: p.nowIso })
  return { ok: true }
}

// 자동롤백 트리거(#5): 활성 후 라이브 품질 급락(최근 추출 0건 비율↑) 감지 시 직전 버전으로 자동 복원.
// degraded 판정은 호출측이 신호 제공(테스트 가능). 직전 활성 스냅샷을 revisions에서 찾아 복원.
export async function autoRollbackIfDegraded(
  db: Db,
  p: { promptKey: string; degraded: boolean; by?: string; nowIso: string },
): Promise<{ rolledBack: boolean; toVersion?: string }> {
  if (!p.degraded) return { rolledBack: false }
  // 현재 active 직전의 활성 스냅샷(auto_activated|activated|rolled_back) 1건
  const { data: revs } = await db.from('ai_prompt_revisions')
    .select('version, content, event').eq('prompt_key', p.promptKey)
    .in('event', ['auto_activated', 'activated', 'rolled_back', 'auto_rolled_back'])
    .order('created_at', { ascending: false }).limit(2)
  const prior = Array.isArray(revs) && revs.length >= 2 ? revs[1] : null
  if (!prior) return { rolledBack: false }
  const r = await rollbackPrompt(db, { promptKey: p.promptKey, toContent: prior.content, toVersion: prior.version, by: p.by ?? 'auto-monitor', auto: true, reason: '라이브 품질 급락 자동 감지', nowIso: p.nowIso })
  return { rolledBack: r.ok, toVersion: prior.version }
}
