import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'
import { createHash } from 'node:crypto'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface MemberRow {
  user_id: string; category: string; performance: string; plan: string; issues: string
  profiles: { name: string; rank: string | null } | null
}

// 하이브리드 취합 프롬프트: 카테고리 섹션 + 작성자 소블록(입력 순서 보존)
const HYBRID_PROMPT = `당신은 기업 주간보고 편집 전문가입니다. 부서원들의 주간보고를 "카테고리 섹션 + 작성자 소블록" 하이브리드 구조로 통합합니다.

## 규칙
1. 카테고리(구분) 의미 통합: 오타·약어·하위개념 등 사실상 같은 업무영역의 구분은 하나로 묶고 가장 포괄적인 명칭 선택. 성격이 명백히 다르면 분리.
2. 각 카테고리 안에서는 **입력에 주어진 작성자 순서(authorOrder)를 그대로 보존**한다. 작성자 경계를 넘어 항목을 교차·재배열 금지.
3. 같은 작성자의 같은 카테고리 항목은 원본 순서 유지.
4. 완전히 동일한 항목만 1개로 병합(먼저 등장한 작성자 블록에 둠). 유사하지만 다른 항목은 각 작성자 것 유지.
5. 작성자 이름·직급은 보존하여 소블록으로 표기.
6. 스타일: 각 필드는 <ul><li>…</li></ul>. 수치·고유명사 원본 유지, 내용 임의 생성 금지. 빈 내용은 "".

## 출력 (순수 JSON 배열만, 마크다운·설명 없이)
[
  { "category": "구분명",
    "authors": [
      { "name": "작성자명", "rank": "직급", "performance": "<ul>...</ul>", "plan": "...", "issues": "..." }
    ]
  }
]
- 카테고리별 1개 객체, authors 배열은 입력 작성자 순서 유지.`

function extractObjects(buf: string, fromIdx: number): { objs: string[]; nextIdx: number } {
  const objs: string[] = []
  let i = fromIdx, depth = 0, start = -1, inStr = false, esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; continue }
    if (c === '{') { if (depth === 0) start = i; depth++ }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { objs.push(buf.slice(start, i + 1)); start = -1 } }
  }
  return { objs, nextIdx: start >= 0 ? start : buf.length }
}

export async function POST(req: NextRequest) {
  const { deptId, weekStart } = await req.json().catch(() => ({}))
  if (!deptId || !weekStart) return new Response('deptId·weekStart 필요', { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('인증 필요', { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const scope = await resolveOrgScope(admin, user.id)
  if (!scope.editableDeptIds.includes(deptId)) return new Response('권한 없음', { status: 403 })

  const memberIds = deptMemberUserIds(scope, deptId)
  if (memberIds.length === 0) return new Response('부서원 없음', { status: 400 })

  const { data: raw } = await admin
    .from('weekly_reports')
    .select('user_id, category, performance, plan, issues, profiles(name, rank)')
    .in('user_id', memberIds).eq('week_start', weekStart).is('deleted_at', null) as { data: MemberRow[] | null }
  const rows = raw ?? []
  if (rows.length === 0) return new Response('해당 주차 부서원 보고 없음', { status: 400 })

  // 직급 서열 맵 (org_ranks.display_order 작을수록 상위)
  const { data: ranks } = await admin.from('org_ranks').select('name, display_order') as { data: { name: string; display_order: number }[] | null }
  const rankOrder = new Map((ranks ?? []).map((r) => [r.name, r.display_order]))
  const rowRank = (r: MemberRow) => rankOrder.get(r.profiles?.rank ?? '') ?? 9999
  // 작성자 순서: 직급 → 이름
  const sorted = [...rows].sort((a, b) => {
    const ra = rowRank(a), rb = rowRank(b)
    if (ra !== rb) return ra - rb
    return (a.profiles?.name ?? '').localeCompare(b.profiles?.name ?? '')
  })

  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = meta.gemini_api_key as string | undefined
  const model = (meta.gemini_model as string | undefined) ?? 'gemini-2.0-flash'
  if (!apiKey) return new Response('Gemini 키 없음', { status: 400 })

  const input = sorted.map((r, i) => ({
    authorOrder: i, name: r.profiles?.name ?? '익명', rank: r.profiles?.rank ?? '',
    category: r.category, performance: r.performance, plan: r.plan, issues: r.issues,
  }))
  const sourceHash = createHash('sha1').update(sorted.map((r) => `${r.user_id}|${r.category}|${r.performance}|${r.plan}|${r.issues}`).join('\n')).digest('hex')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`))
      try {
        send({ type: 'members', members: input.map((m) => ({ name: m.name, rank: m.rank, category: m.category })) })

        const res = await fetch(`${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${HYBRID_PROMPT}\n\n입력(작성자 직급→이름 순 정렬됨):\n${JSON.stringify(input, null, 2)}` }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
          }),
        })
        if (!res.ok || !res.body) { send({ type: 'error', message: `AI 호출 실패 (${res.status})` }); controller.close(); return }

        const reader = res.body.getReader(); const decoder = new TextDecoder()
        let textAcc = '', scanIdx = 0, sseBuf = ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const merged: any[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          sseBuf += decoder.decode(value, { stream: true })
          const lines = sseBuf.split('\n'); sseBuf = lines.pop() ?? ''
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith('data:')) continue
            const payload = t.slice(5).trim()
            if (payload === '[DONE]') continue
            try {
              const j = JSON.parse(payload)
              const piece = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
              if (piece) {
                textAcc += piece
                const { objs, nextIdx } = extractObjects(textAcc, scanIdx); scanIdx = nextIdx
                for (const o of objs) {
                  try { const parsed = JSON.parse(o); if (parsed?.category && Array.isArray(parsed.authors)) { merged.push(parsed); send({ type: 'category', item: parsed }) } } catch { /* partial */ }
                }
              }
            } catch { /* non-json sse */ }
          }
        }

        await admin.from('dept_weekly_reports').upsert(
          { department_id: deptId, week_start: weekStart, body: merged, source_hash: sourceHash, status: 'draft', edited_by: user.id },
          { onConflict: 'department_id,week_start' },
        )
        send({ type: 'done', count: merged.length })
        controller.close()
      } catch (e) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : '취합 실패' })}\n\n`))
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}
