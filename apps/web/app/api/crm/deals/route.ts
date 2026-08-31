// GET  /api/crm/deals — 커서 목록 (보드는 status=OPEN 으로 좁힌다)
// POST /api/crm/deals — 생성
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, readListQuery } from '@/lib/crm/api/handler'
import { listDeals, sumDeals, createDeal, toDealJson, type DealInput } from '@/lib/crm/services/deal'
import { nextActions } from '@/lib/crm/services/next-action'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const { cursor, limit, q } = readListQuery(req)
    const sp = new URL(req.url).searchParams
    // 목록과 합계가 **같은 조건**을 본다 — 따로 적으면 둘이 어긋나고 합계가 틀린다
    const filter = {
      q,
      pipelineId: sp.get('pipelineId'),
      companyId: sp.get('companyId'),
      status: sp.get('status'),
      trash: sp.get('trash') === '1',
    }
    /**
     * `agg=0` 이면 총 건수·합계를 계산하지 않는다.
     *
     * **왜**: 합계는 상한 없이 딜을 전부 읽는다(그래야 「앞의 200건만 더한 합계」가 안 된다).
     * 그런데 **보드는 그 숫자를 화면에 쓰지 않는다** — 실측에서 보드의 두 번째 호출이
     * 1,248ms 였고 그중 대부분이 아무도 안 보는 합계였다.
     * 기본값은 예전과 같다(계산한다) — 끄는 쪽이 명시한다.
     */
    const agg = sp.get('agg') !== '0'
    const page = await listDeals(db, { cursor, limit, ...filter, agg })
    /**
     * 다음에 할 일을 함께 준다.
     *
     * **왜 목록에 섞어 주나**: 딜마다 따로 물으면 보드에 딜이 100개일 때 조회가 100번이다.
     * 그리고 "다음에 뭘 할지"는 딜 카드에서 **바로 보여야** 의미가 있다 —
     * 눌러 들어가야 보이면 사람은 안 본다(그래서 우리 보드가 정적인 목록이었다).
     */
    const items = page.items.map(toDealJson)
    // 합계는 **서버가** 센다 — 화면에서 더하면 「지금 보이는 20건」의 합이 되고,
    // 사람은 그걸 전체 합계로 읽는다
    const [actions, sums] = await Promise.all([
      nextActions(db, page.items.map((d) => d.id)),
      agg ? sumDeals(db, filter) : Promise.resolve(undefined),
    ])

    return {
      items: items.map((d) => ({ ...d, nextAction: actions.get(String(d.id)) ?? null })),
      nextCursor: page.nextCursor,
      // 응답을 손으로 다시 조립하는 곳이라 total 을 빠뜨리기 쉽다 —
      // 실제로 회사·인물만 총 건수가 뜨고 딜만 안 뜨는 상태였다
      total: page.total,
      sums,
    }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const deal = await createDeal(session.workspaceId, session.memberId, body as unknown as DealInput)
    return toDealJson(deal)
  })
}
