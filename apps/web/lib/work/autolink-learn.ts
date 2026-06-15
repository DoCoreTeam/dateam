// 자동연결 학습(Level 1·2) — 임계 보정 + 별칭사전 + few-shot 빌더. (서버, autolink-run/route에서 사용)
import { adjustThreshold, DEFAULT_THRESHOLDS, type LinkKind, type Thresholds } from './autolink'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

const KINDS: LinkKind[] = ['log', 'account', 'deal', 'contact']

/** Level 1 — autolink_feedback 집계로 종류별 임계 재계산 → autolink_config 갱신. (해제=오답 신호) */
export async function recomputeThresholds(db: Db): Promise<Thresholds> {
  const { data: cfgRow } = await db.from('autolink_config').select('thresholds').eq('id', 1).single()
  const current: Thresholds = { ...DEFAULT_THRESHOLDS, ...(cfgRow?.thresholds ?? {}) }
  const next: Thresholds = { ...current }
  for (const kind of KINDS) {
    const [{ count: autoCreated }, { count: unlinked }] = await Promise.all([
      db.from('autolink_feedback').select('id', { count: 'exact', head: true }).eq('target_kind', kind).eq('action', 'auto_created'),
      db.from('autolink_feedback').select('id', { count: 'exact', head: true }).eq('target_kind', kind).eq('action', 'unlink'),
    ])
    next[kind] = adjustThreshold(current[kind], { autoCreated: autoCreated ?? 0, unlinked: unlinked ?? 0 })
  }
  await db.from('autolink_config').update({ thresholds: next, updated_at: new Date().toISOString() }).eq('id', 1)
  return next
}

/** Level 2 — 확정된 엔티티 매칭에서 별칭(raw 표기 → 엔티티) 누적. weight++ */
export async function recordAlias(db: Db, rawName: string, kind: LinkKind, entityId: string): Promise<void> {
  const name = rawName.trim()
  if (!name || kind === 'log') return
  // 멱등 upsert + weight 증가
  const { data: existing } = await db.from('autolink_alias').select('id, weight').eq('raw_name', name).eq('kind', kind).eq('entity_id', entityId).maybeSingle?.() ?? { data: null }
  if (existing?.id) {
    await db.from('autolink_alias').update({ weight: (existing.weight ?? 1) + 1, updated_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    await db.from('autolink_alias').insert({ raw_name: name, kind, entity_id: entityId }).then(undefined, () => {})
  }
}

/** Level 2 — judge 프롬프트에 주입할 few-shot(최근 해제=오답 사례 + 별칭 힌트). 길이 제한. */
export async function buildFewShot(db: Db): Promise<string> {
  const [{ data: unlinks }, { data: aliases }] = await Promise.all([
    db.from('autolink_feedback').select('target_kind, action').eq('action', 'unlink').order('created_at', { ascending: false }).limit(5),
    db.from('autolink_alias').select('raw_name, kind').order('weight', { ascending: false }).limit(10),
  ])
  const parts: string[] = []
  if ((aliases?.length ?? 0) > 0) {
    parts.push('[학습된 표기]\n' + aliases.map((a: Record<string, unknown>) => `"${a.raw_name}"=${a.kind}`).join(', '))
  }
  if ((unlinks?.length ?? 0) > 0) {
    parts.push(`[주의] 최근 사용자가 해제한 ${unlinks.length}건의 ${unlinks.map((u: Record<string, unknown>) => u.target_kind).join('/')} 연결이 있었습니다 — 비슷하게 약한 연관은 related=false로 보수적으로 판단하세요.`)
  }
  return parts.length ? '\n\n' + parts.join('\n') : ''
}
