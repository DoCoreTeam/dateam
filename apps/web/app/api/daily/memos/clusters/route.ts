import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { cosineSimilarity } from '@/lib/gemini-embedding'
import { logTokenUsage } from '@/lib/token-logger'

const SIM_THRESHOLD = 0.78  // 코사인 유사도 임계 — 같은 주제로 묶는 기준
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface MemoRow {
  id: string
  content: string
  logged_at: string
  embedding: string | null
}

interface Cluster {
  id: number
  label: string
  memoIds: string[]
  count: number
  centroid: number[]
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null
  try {
    const arr = JSON.parse(raw) as number[]
    return Array.isArray(arr) && arr.length > 0 ? arr : null
  } catch {
    return null
  }
}

// GET /api/daily/memos/clusters — 미처리(new/reviewed) 메모를 주제별로 그룹핑
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증 필요' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('daily_logs') as any)
    .select('id, content, logged_at, embedding')
    .eq('user_id', user.id)
    .eq('entry_type', 'note')
    .eq('is_onboarding', false)  // onboarding: 임베딩 클러스터링(AI) 입력 — 실습 행 제외
    .in('memo_status', ['new', 'reviewed'])
    .order('logged_at', { ascending: false })
    .limit(200)

  const rows = (data ?? []) as MemoRow[]
  const withEmb = rows
    .map((r) => ({ ...r, vec: parseEmbedding(r.embedding) }))
    .filter((r): r is MemoRow & { vec: number[] } => r.vec !== null)

  // 임베딩 없는 메모는 '기타' 처리용으로 보관
  const noEmb = rows.filter((r) => !parseEmbedding(r.embedding))

  // 그리디 클러스터링: 각 메모를 가장 가까운 기존 클러스터에 배정, 없으면 새 클러스터
  const clusters: Cluster[] = []
  for (const row of withEmb) {
    let best: { c: Cluster; sim: number } | null = null
    for (const c of clusters) {
      const sim = cosineSimilarity(row.vec, c.centroid)
      if (sim >= SIM_THRESHOLD && (!best || sim > best.sim)) best = { c, sim }
    }
    if (best) {
      best.c.memoIds.push(row.id)
      best.c.count++
      // centroid 갱신 (누적 평균)
      const n = best.c.count
      for (let i = 0; i < best.c.centroid.length; i++) {
        best.c.centroid[i] = (best.c.centroid[i] * (n - 1) + row.vec[i]) / n
      }
    } else {
      clusters.push({ id: clusters.length, label: '', memoIds: [row.id], count: 1, centroid: [...row.vec] })
    }
  }

  // 단독(1건) 클러스터가 너무 많으면 노이즈 → '기타'로 통합
  const named = clusters.filter((c) => c.count >= 2)
  const singletonIds = clusters.filter((c) => c.count < 2).flatMap((c) => c.memoIds)
  const etcIds = [...singletonIds, ...noEmb.map((r) => r.id)]

  // 대표 메모 텍스트 모아 Gemini 1회 배치 라벨링
  if (named.length > 0) {
    const contentById = new Map(rows.map((r) => [r.id, r.content]))
    const repForLabel = named.map((c, idx) => ({
      idx,
      samples: c.memoIds.slice(0, 3).map((id) => contentById.get(id) ?? '').filter(Boolean),
    }))
    try {
      const labels = await batchLabel(repForLabel, user.id)
      named.forEach((c, idx) => { c.label = labels[idx] || `주제 ${idx + 1}` })
    } catch (e) {
      console.error('[clusters] label failed', e)
      named.forEach((c, idx) => { c.label = `주제 ${idx + 1}` })
    }
  }

  const result = named.map((c) => ({ label: c.label, memoIds: c.memoIds, count: c.count }))
  if (etcIds.length > 0) result.push({ label: '기타', memoIds: etcIds, count: etcIds.length })

  return NextResponse.json(
    { clusters: result, total: rows.length },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

async function batchLabel(
  groups: { idx: number; samples: string[] }[],
  userId: string
): Promise<string[]> {
  const adm = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adm as any).from('org_content').select('value').eq('key', 'META').single()
  const meta = (data?.value ?? {}) as Record<string, unknown>
  const apiKey = (meta.gemini_api_key as string) || process.env.GEMINI_API_KEY || ''
  const model = (meta.gemini_model as string) || 'gemini-2.0-flash'
  if (!apiKey) return groups.map((g) => `주제 ${g.idx + 1}`)

  const prompt = `다음은 업무 메모를 주제별로 묶은 그룹들이다. 각 그룹에 2~6자 한국어 짧은 라벨을 붙여라.
거래처명·제품·주제 등 핵심 키워드 위주. 순수 JSON 배열만 출력: [{"idx":0,"label":"..."}]

그룹:
${JSON.stringify(groups, null, 2)}`

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
  logTokenUsage({
    userId,
    feature: 'memo-cluster-label',
    model,
    promptTokens: json.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    totalTokens: json.usageMetadata?.totalTokenCount ?? 0,
  })
  const parsed = JSON.parse(text) as { idx: number; label: string }[]
  const out: string[] = groups.map((g) => `주제 ${g.idx + 1}`)
  for (const p of parsed) {
    if (typeof p.idx === 'number' && p.idx >= 0 && p.idx < out.length) out[p.idx] = p.label
  }
  return out
}
