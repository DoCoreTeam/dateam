// 업무 자동 연관 연결 — 서버 오케스트레이션(임베딩→pgvector 리콜→LLM 판정→밴드→연결 삽입).
// 완전 자동: 호출 시 무개입으로 daily_log_relations(업무↔업무) + work_entity_links(거래처/딜/연락처) 생성.
// 가역: created_by='ai', weak(추천/확정), confidence/reason 저장. 모든 생성은 autolink_feedback(auto_created) 기록(학습).
// SSOT 재사용: embedText/toVectorLiteral, getGeminiConfig/callGeminiOnce, decideLinks(순수규칙).
import { createAdminClient } from '@/lib/supabase/server'
import { embedText, toVectorLiteral } from '@/lib/gemini-embedding'
import { getGeminiConfig, callGeminiOnce } from '@/lib/gpu/extract-helpers'
import { decideLinks, type JudgedCandidate, type LinkKind, type Thresholds, DEFAULT_THRESHOLDS } from './autolink'
import { buildFewShot, recordAlias } from './autolink-learn'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

interface RunResult { ok: boolean; created: number; relations: number; entities: number; error?: string }

// 문자 bigram Jaccard — 이름 겹침 가드용(pg_trgm 근사). 0~1.
function nameSim(a: string, b: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-_.()]/g, '')
  const grams = (s: string): string[] => { const g: string[] = []; for (let i = 0; i < s.length - 1; i++) { const t = s.slice(i, i + 2); if (!g.includes(t)) g.push(t) } return g }
  const A = grams(norm(a)), B = grams(norm(b))
  if (A.length === 0 || B.length === 0) return 0
  const bset = new Set(B)
  const inter = A.filter((x) => bset.has(x)).length
  return inter / (A.length + B.length - inter)
}

async function loadThresholds(db: Db): Promise<Thresholds> {
  try {
    const { data } = await db.from('autolink_config').select('thresholds').eq('id', 1).single()
    const t = data?.thresholds
    return t && typeof t === 'object' ? { ...DEFAULT_THRESHOLDS, ...t } : DEFAULT_THRESHOLDS
  } catch { return DEFAULT_THRESHOLDS }
}

function parseJson<T>(s: string): T | null { try { return JSON.parse(s) as T } catch { return null } }

async function getPrompt(db: Db, key: string): Promise<string | null> {
  const { data } = await db.from('ai_prompts').select('content').eq('prompt_key', key).eq('active', true).single()
  return typeof data?.content === 'string' ? data.content : null
}

/** 한 업무에 대해 자동 연관 연결 실행. 멱등(이미 있는 연결은 unique로 무시). */
export async function runAutolink(logId: string, actor: string): Promise<RunResult> {
  const db = createAdminClient() as Db
  const cfg = await getGeminiConfig(db)
  if (!cfg.apiKey) return { ok: false, created: 0, relations: 0, entities: 0, error: 'AI 키 미설정' }

  // 0) 기준 업무 로드 + 임베딩 확보
  const { data: log } = await db.from('daily_logs').select('id, content, original_input, embedding, user_id').eq('id', logId).single()
  if (!log) return { ok: false, created: 0, relations: 0, entities: 0, error: '업무 없음' }
  const baseText = (log.content || log.original_input || '').trim()
  if (!baseText) return { ok: true, created: 0, relations: 0, entities: 0 }

  let vecLiteral: string | null = typeof log.embedding === 'string' ? log.embedding : null
  if (!vecLiteral) {
    const emb = await embedText(baseText, cfg.apiKey, log.user_id)
    if (emb) { vecLiteral = toVectorLiteral(emb.embedding); await db.from('daily_logs').update({ embedding: vecLiteral }).eq('id', logId) }
  }
  if (!vecLiteral) return { ok: false, created: 0, relations: 0, entities: 0, error: '임베딩 실패' }

  const th = await loadThresholds(db)

  // 1) 리콜 (pgvector top-K) — 업무 + 엔티티
  const [logsR, accR, dealR, conR] = await Promise.all([
    db.rpc('match_daily_logs', { query_embedding: vecLiteral, exclude_id: logId, match_count: 20, min_sim: th.log.tau_suggest - 0.05 }),
    db.rpc('match_accounts', { query_embedding: vecLiteral, match_count: 10, min_sim: th.account.tau_suggest - 0.05 }),
    db.rpc('match_deals', { query_embedding: vecLiteral, match_count: 10, min_sim: th.deal.tau_suggest - 0.05 }),
    db.rpc('match_contacts', { query_embedding: vecLiteral, match_count: 10, min_sim: th.contact.tau_suggest - 0.05 }),
  ])
  const cand: Array<{ candidate_id: string; kind: LinkKind; text: string; sim: number; name?: string }> = []
  for (const r of (logsR.data ?? [])) cand.push({ candidate_id: r.id, kind: 'log', text: String(r.content ?? '').slice(0, 200), sim: r.similarity })
  for (const r of (accR.data ?? [])) cand.push({ candidate_id: r.id, kind: 'account', text: String(r.name ?? ''), sim: r.similarity, name: r.name })
  for (const r of (dealR.data ?? [])) cand.push({ candidate_id: r.id, kind: 'deal', text: String(r.title ?? ''), sim: r.similarity, name: r.title })
  for (const r of (conR.data ?? [])) cand.push({ candidate_id: r.id, kind: 'contact', text: String(r.name ?? ''), sim: r.similarity, name: r.name })

  // 1-b) 엔티티 추출 + 이름 매칭 (임베딩이 약한 짧은 고유명사 보완). rawName→candidate 기록(L2 별칭 학습용).
  const rawNameById = new Map<string, string>()
  try {
    const extractPrompt = await getPrompt(db, 'work.autolink-extract')
    if (extractPrompt) {
      const ex = parseJson<{ companies?: string[]; people?: string[]; deals?: string[] }>(
        await callGeminiOnce(cfg.apiKey, cfg.model, `${extractPrompt}\n\n[업무]\n${baseText.slice(0, 1000)}`, true))
      const names = [...(ex?.companies ?? []), ...(ex?.people ?? []), ...(ex?.deals ?? [])].map((s) => String(s).trim()).filter(Boolean)
      if (names.length > 0) {
        const [allAcc, allDeal, allCon] = await Promise.all([
          db.from('accounts').select('id, name').limit(500),
          db.from('deals').select('id, title').limit(500),
          db.from('contacts').select('id, name').limit(500),
        ])
        const pools: Array<{ kind: LinkKind; rows: Array<{ id: string; nm: string }> }> = [
          { kind: 'account', rows: (allAcc.data ?? []).map((r: Record<string, unknown>) => ({ id: r.id as string, nm: String(r.name ?? '') })) },
          { kind: 'deal', rows: (allDeal.data ?? []).map((r: Record<string, unknown>) => ({ id: r.id as string, nm: String(r.title ?? '') })) },
          { kind: 'contact', rows: (allCon.data ?? []).map((r: Record<string, unknown>) => ({ id: r.id as string, nm: String(r.name ?? '') })) },
        ]
        const seen = new Set(cand.map((c) => c.candidate_id))
        for (const nm of names) {
          for (const pool of pools) {
            for (const row of pool.rows) {
              if (!row.nm) continue
              const ns = nameSim(nm, row.nm)
              if (ns >= 0.4) {
                rawNameById.set(row.id, nm)
                if (!seen.has(row.id)) {
                  seen.add(row.id)
                  cand.push({ candidate_id: row.id, kind: pool.kind, text: row.nm, sim: ns, name: row.nm })
                }
              }
            }
          }
        }
      }
    }
  } catch { /* 추출 실패는 임베딩 후보로 진행 */ }

  if (cand.length === 0) return { ok: true, created: 0, relations: 0, entities: 0 }

  // 2) LLM 판정 (배치) — 후보가 기준 업무와 진짜 관련인지/관계/신뢰도/근거
  const judgePrompt = await getPrompt(db, 'work.autolink-judge')
  if (!judgePrompt) return { ok: false, created: 0, relations: 0, entities: 0, error: '판정 프롬프트 미설정' }
  const fewShot = await buildFewShot(db)   // L2: 학습된 별칭 + 최근 해제(오답) 주의
  const judgeInput = `${judgePrompt}${fewShot}\n\n[기준 업무]\n${baseText.slice(0, 1000)}\n\n[후보]\n${JSON.stringify(cand.map((c) => ({ candidate_id: c.candidate_id, kind: c.kind, text: c.text })))}`
  const judged = parseJson<{ results?: Array<{ candidate_id: string; related: boolean; relation: string; confidence: number; reason: string }> }>(
    await callGeminiOnce(cfg.apiKey, cfg.model, judgeInput, true))
  const results = judged?.results ?? []
  const byId = new Map(cand.map((c) => [c.candidate_id, c]))

  // 3) 밴드 결정(순수 규칙 + 이름 가드)
  const judgedCands: JudgedCandidate[] = results.map((r) => {
    const c = byId.get(r.candidate_id)
    return {
      id: r.candidate_id, kind: (c?.kind ?? 'log') as LinkKind,
      confidence: typeof r.confidence === 'number' ? r.confidence : 0,
      related: r.related === true, relation: r.relation ?? 'related', reason: String(r.reason ?? '').slice(0, 300),
      nameSim: c?.name ? nameSim(c.name, baseText) : undefined,
    }
  }).filter((c) => byId.has(c.id))
  const decisions = decideLinks(judgedCands, th)

  // 4) 연결 삽입 (멱등) + 학습신호 기록
  let relations = 0, entities = 0
  const feedbackRows: Db[] = []
  for (const d of decisions) {
    if (d.kind === 'log') {
      const relType = d.relation === 'derived_from' ? 'derived_from' : 'related'
      // 멱등: 동일 (from,to,type) 있으면 skip (unique 제약 없으므로 존재확인)
      const { data: exist } = await db.from('daily_log_relations').select('id')
        .eq('from_log_id', logId).eq('to_log_id', d.id).eq('relation_type', relType).limit(1)
      if (exist && exist.length > 0) continue
      const { error } = await db.from('daily_log_relations').insert({
        from_log_id: logId, to_log_id: d.id, relation_type: relType,
        created_by: 'ai', confidence: d.confidence, reason: d.reason, weak: d.weak,
      })
      if (!error) relations++
      feedbackRows.push({ log_id: logId, target_kind: 'log', target_id: d.id, action: 'auto_created', band: d.band, confidence: d.confidence, created_by: actor })
    } else {
      const { error } = await db.from('work_entity_links').upsert({
        log_id: logId, kind: d.kind, entity_id: d.id, confidence: d.confidence, reason: d.reason, weak: d.weak, created_by: 'ai',
      }, { onConflict: 'log_id,kind,entity_id', ignoreDuplicates: true })
      if (!error) entities++
      feedbackRows.push({ log_id: logId, target_kind: d.kind, target_id: d.id, action: 'auto_created', band: d.band, confidence: d.confidence, created_by: actor })
      // L2: 확정 연결의 추출 표기를 별칭사전에 누적(다음 매칭 정확도↑)
      const raw = rawNameById.get(d.id)
      if (raw && !d.weak) await recordAlias(db, raw, d.kind, d.id)
    }
  }
  if (feedbackRows.length > 0) await db.from('autolink_feedback').insert(feedbackRows).then(undefined, () => {})

  return { ok: true, created: relations + entities, relations, entities }
}
