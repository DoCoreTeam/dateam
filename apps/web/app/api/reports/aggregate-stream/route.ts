import { NextRequest } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveOrgScope, deptMemberUserIds } from '@/lib/org-scope'
import { MERGE_BY_CATEGORY_PROMPT } from '@/lib/gemini-refine'
import { createHash } from 'node:crypto'

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

interface MemberRow {
  user_id: string; category: string; performance: string; plan: string; issues: string
  profiles: { name: string } | null
}

// 누적 텍스트에서 완성된 최상위 {…} 객체를 추출 (배열 스트리밍 부분 파싱)
function extractObjects(buf: string, fromIdx: number): { objs: string[]; nextIdx: number } {
  const objs: string[] = []
  let i = fromIdx
  let depth = 0, start = -1, inStr = false, esc = false
  for (; i < buf.length; i++) {
    const c = buf[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') { if (depth === 0) start = i; depth++ }
    else if (c === '}') {
      depth--
      if (depth === 0 && start >= 0) { objs.push(buf.slice(start, i + 1)); start = -1 }
    }
  }
  // 완성되지 않은 객체 시작 지점부터 다음에 다시 스캔
  const nextIdx = start >= 0 ? start : buf.length
  return { objs, nextIdx }
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
    .select('user_id, category, performance, plan, issues, profiles(name)')
    .in('user_id', memberIds).eq('week_start', weekStart).is('deleted_at', null) as { data: MemberRow[] | null }
  const rows = raw ?? []
  if (rows.length === 0) return new Response('해당 주차 부서원 보고 없음', { status: 400 })

  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const apiKey = meta.gemini_api_key as string | undefined
  const model = (meta.gemini_model as string | undefined) ?? 'gemini-2.0-flash'
  if (!apiKey) return new Response('Gemini 키 없음', { status: 400 })

  const input = rows.map((r) => ({ userName: r.profiles?.name ?? '익명', category: r.category, performance: r.performance, plan: r.plan, issues: r.issues }))
  const sourceHash = createHash('sha1').update(rows.map((r) => `${r.user_id}|${r.category}|${r.performance}|${r.plan}|${r.issues}`).sort().join('\n')).digest('hex')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      try {
        // 취합 대상 부서원 보고(상태 포함) 먼저 전송 — "분석 중" 화면용
        send({ type: 'members', members: rows.map((r) => ({ name: r.profiles?.name ?? '익명', category: r.category })) })

        const res = await fetch(`${GEMINI_API_BASE}/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${MERGE_BY_CATEGORY_PROMPT}\n\n입력 데이터:\n${JSON.stringify(input, null, 2)}` }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
          }),
        })
        if (!res.ok || !res.body) { send({ type: 'error', message: `AI 호출 실패 (${res.status})` }); controller.close(); return }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let textAcc = ''   // Gemini가 생성한 JSON 본문 누적
        let scanIdx = 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const merged: any[] = []
        let sseBuf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          sseBuf += decoder.decode(value, { stream: true })
          const lines = sseBuf.split('\n')
          sseBuf = lines.pop() ?? ''
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
                const { objs, nextIdx } = extractObjects(textAcc, scanIdx)
                scanIdx = nextIdx
                for (const o of objs) {
                  try {
                    const parsed = JSON.parse(o)
                    if (parsed?.category) { merged.push(parsed); send({ type: 'category', item: parsed }) }
                  } catch { /* skip partial */ }
                }
              }
            } catch { /* skip non-json sse */ }
          }
        }

        // 스냅샷 저장 (draft)
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
