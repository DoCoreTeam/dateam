// POST /api/crm/companies/enrich — 고른 회사 여러 곳을 웹에서 찾아 빈 칸을 채운다
//
// 정적 세그먼트라 /api/crm/companies/[id] 보다 먼저 잡힌다("enrich" 라는 id 는 없다).
//
// 한 건이 실패해도 나머지는 계속한다. 무엇이 됐고 무엇이 안 됐는지를 응답으로 돌려주므로,
// 화면은 "N곳 채웠고 M곳은 이래서 못 했어요"라고 말할 수 있다 — 조용히 삼키지 않는다.
//
// **응답은 두 모양이다.** `Accept: text/event-stream` 이면 한 곳 끝날 때마다 진행을 흘려보내고,
// 아니면 예전처럼 JSON 한 덩어리다(추가 전용 — 기존 호출부는 그대로 돈다).
import type { NextRequest } from 'next/server'

/**
 * 회사당 웹검색 AI 호출이 실측 15~30초이고 **순차로** 돈다(예산 선점이 동시에 통과하지 않도록).
 * 상한 20곳이면 최악 5~10분이라, 선언이 없으면 프로덕션에서 **응답이 오기 전에 함수가 죽는다.**
 *
 * 이 결함은 개발 중에 절대 안 보인다 — 로컬 dev 에는 함수 시간 상한이 없기 때문이다.
 * 형제 AI 라우트(analyze/stream · cron/analyze-drain · leads/parse)가 전부 300 인데
 * 여기만 선언이 0줄이었다(v0.7.574 에서 발견).
 */
export const maxDuration = 300
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { adapterFromSetting } from '@/lib/crm/services/quick-create'
import { enrichCompaniesFromWeb } from '@/lib/crm/services/enrich-web'

export async function POST(req: NextRequest) {
  const wantsStream = (req.headers.get('accept') ?? '').includes('text/event-stream')

  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    const raw = body.companyIds
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
      throw new CrmError('VALIDATION_FAILED', '보강할 회사를 골라 주세요.')
    }
    // 중복을 걸러 낸다 — 같은 회사를 두 번 고르면 웹 검색이 두 번 나가고 두 번 결제된다
    const companyIds = Array.from(new Set(raw as string[]))

    // 웹 검색을 못 하는 프로바이더면 어댑터가 여기서 분명히 실패한다 —
    // 기억으로 답한 값을 "찾았다"고 보여 주지 않기 위해서다(host.ts).
    const adapter = await adapterFromSetting(db, { webSearch: true })

    if (!wantsStream) {
      return enrichCompaniesFromWeb(db, session.workspaceId, session.memberId, companyIds, adapter)
    }

    /**
     * 스트림이 열린 뒤의 실패는 **상태 코드를 바꿀 수 없다.**
     * 그래서 오류도 이벤트로 내보낸다 — 안 그러면 화면에서 그냥 끊긴 것처럼 보인다.
     */
    const encoder = new TextEncoder()
    let closed = false
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          } catch {
            closed = true   // 이미 닫힘
          }
        }
        // 첫 이벤트를 곧바로 보낸다 — 프록시가 응답을 붙들고 있지 않게, 화면도 즉시 0/N 을 그린다
        send('progress', { done: 0, total: companyIds.length })
        try {
          const result = await enrichCompaniesFromWeb(
            db, session.workspaceId, session.memberId, companyIds, adapter,
            (p) => send('progress', p),
          )
          send('done', result)
        } catch (e) {
          const message = e instanceof CrmError ? e.message : 'AI 보강에 실패했습니다.'
          send('failed', { message })
        }
        try { controller.close() } catch { /* 이미 닫힘 */ }
      },
      cancel() {
        // 사용자가 화면을 떠났다 — 더 보내지 않는다(서버 쪽 진행은 그대로 끝난다)
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
  })
}
