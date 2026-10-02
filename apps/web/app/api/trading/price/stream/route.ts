import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { tradingAccess } from '@/lib/trading/access'
import { liveWindowAt } from '@/lib/trading/live-window'
import { loadLivePriceContext, readLivePrice } from '@/lib/trading/bars/live-price'
import { sseEvent } from '@/lib/trading/bars/live-price-core'
import { recordSystemEvent } from '@/lib/system-log/record'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const STREAM_LIFETIME_MS = 50_000
const encoder = new TextEncoder()
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function GET(request: Request): Promise<Response> {
  // 임직원 문과 트레이딩 소유자 문을 둘 다 지난다. 관리자인 것만으로는 통과하지 않는다.
  const member = await requireMemberApi()
  if (member.error) return member.error
  const owner = await tradingAccess()
  if (!owner.allowed) {
    return Response.json({ error: owner.userMessage ?? '권한이 없습니다' }, { status: 403 })
  }

  let context
  try {
    context = await loadLivePriceContext(new Date())
  } catch (error) {
    await noteRouteFailure(error)
    return Response.json({ error: '실시간 가격 준비에 실패했습니다' }, { status: 503 })
  }
  if (!context) {
    return Response.json({ error: '현재 월물이 아직 정해지지 않았습니다' }, { status: 503 })
  }

  const runId = `price-stream-${crypto.randomUUID()}`
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now()
      let lastObservedAt: string | null = null
      let closed = false
      const close = (): void => {
        if (closed) return
        closed = true
        controller.close()
      }
      request.signal.addEventListener('abort', close, { once: true })

      controller.enqueue(encoder.encode('retry: 2000\n\n'))
      try {
        while (!closed && Date.now() - startedAt < STREAM_LIFETIME_MS) {
          const now = new Date()
          if (!liveWindowAt(now).live) break

          const result = await readLivePrice(context, now, runId)
          if (result.price && result.price.observedAt !== lastObservedAt) {
            lastObservedAt = result.price.observedAt
            controller.enqueue(encoder.encode(sseEvent('price', result.price)))
          }
          if (!result.ok) {
            controller.enqueue(encoder.encode(sseEvent('status', { state: 'retrying' })))
          } else if (!result.price) {
            controller.enqueue(encoder.encode(': waiting for the first price\n\n'))
          }
          await sleep(context.pushSeconds * 1_000)
        }
      } catch (error) {
        await noteRouteFailure(error)
        if (!closed) controller.enqueue(encoder.encode(sseEvent('status', { state: 'retrying' })))
      } finally {
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    },
  })
}

async function noteRouteFailure(error: unknown): Promise<void> {
  await recordSystemEvent({
    source: 'host_api',
    feature: 'trading/live-price',
    route: '/api/trading/price/stream',
    error,
    blocksUser: false,
  })
}
