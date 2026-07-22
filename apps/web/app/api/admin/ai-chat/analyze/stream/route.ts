// 목록 심층분석 v2 — SSE 진행 스트림. 실행주체는 lib/ai-chat/analyze-runner.ts(drainSession, SSOT).
// 클라 이탈(AbortSignal)이 signal에 전파되지만 서버 작업 자체는 죽지 않는다 — 미완이면
// 다음 크론 틱(app/api/cron/analyze-drain)이 이어받는다(§ 오케스트레이터 프로토콜).

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { drainSession } from '@/lib/ai-chat/analyze-runner'

export const runtime = 'nodejs'
export const maxDuration = 300

const DEADLINE_MS = 270_000 // maxDuration 300 여유(§ 크론 드레인 결정)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

function sse(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`)
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: { sessionId?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: '요청 형식 오류' }), { status: 400 })
  }
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) {
    return new Response(JSON.stringify({ error: '세션 ID가 필요합니다' }), { status: 400 })
  }

  const admin: AdminClient = createAdminClient()

  // owner 검증 — RLS도 동일 조건을 강제하지만 명시적 404를 위해 선확인.
  const { data: owned } = await admin
    .from('ai_analysis_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', auth.user.id)
    .is('deleted_at', null)
    .single()
  if (!owned) {
    return new Response(JSON.stringify({ error: '세션을 찾을 수 없습니다' }), { status: 404 })
  }

  // closed는 start/cancel 양쪽에서 공유한다 — 클라 이탈(cancel)로 controller가 닫힌 걸
  // start 쪽 enqueue가 알 수 있어야 한다. 이 플래그가 없으면 닫힌 controller에 enqueue해
  // "Invalid state: Controller is already closed"가 나고, 그 예외가 onDelta를 타고 항목
  // 처리까지 전파되어 항목이 error로 오염됐다(실측: 심화 중 페이지 이탈 → 전 항목 error).
  let closed = false
  const stream = new ReadableStream({
    async start(controller) {
      // enqueue는 절대 throw하지 않는다 — 스트림 write 실패가 AI 항목 처리를 죽이면 안 된다.
      // write가 실패해도(클라 이탈) 항목 처리는 계속되고, 미완은 크론이 이어받아 완주한다.
      const enqueue = (obj: unknown) => {
        if (closed) return
        try {
          controller.enqueue(sse(obj))
        } catch {
          closed = true // 이미 닫힘(클라 abort 등) — 이후 write 중단, 처리는 계속
        }
      }

      try {
        const { drained, progress } = await drainSession(admin, sessionId, {
          deadlineMs: DEADLINE_MS,
          signal: req.signal,
          onProgress: (p) => enqueue({ progress: p }),
          onDelta: (itemIdx, delta) => enqueue({ itemIdx, delta }),
        })
        enqueue({ done: true, drained, progress })
      } catch (err) {
        console.error('[ai-chat/analyze/stream] drain error', err)
        const message = err instanceof Error ? err.message : '분석 중 오류가 발생했습니다'
        enqueue({ error: message })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          // 이미 닫힘
        }
      }
    },
    cancel() {
      // 클라이언트 연결 끊김 — 이후 enqueue를 즉시 중단(서버 drain은 백그라운드로 계속).
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
