// GET  /api/crm/activities — 활동 조회 (occurredAt 역순)
//
// 두 자리가 이 창구를 쓴다. **권한 장치는 하나다**(withCrmApi).
//   · 타임라인: 딜·회사·인물 상세 안쪽. 대상 하나로 걸러 「더 보기」로 이어 읽는다
//   · 목록 화면(/crm/activities): 종류·담당자·기간으로 걸러 보고 전체 건수를 함께 받는다
//
// 워크스페이스는 `withCrmApi` 가 준 `db` 가 건다(getCrmDb 의 질의 확장). 주소로 받는
// 조건에 workspaceId 가 없으므로 남의 워크스페이스 id 를 넣어도 걸릴 자리가 없다.
// POST /api/crm/activities — 노트·통화·미팅 기록 남기기
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listActivities, createActivity, type ActivityInput } from '@/lib/crm/services/activity'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const sp = new URL(req.url).searchParams
    const limitRaw = sp.get('limit')
    return listActivities(db, {
      limit: limitRaw ? Number(limitRaw) : null,
      before: sp.get('before'),
      companyId: sp.get('companyId'),
      personId: sp.get('personId'),
      dealId: sp.get('dealId'),
      types: sp.get('types'),
      createdById: sp.get('createdById'),
      // 리포트의 「접촉 건수」에서 넘어온 조건. 그 카드가 센 것과 같은 것을 센다
      human: sp.get('human') === '1',
      from: sp.get('from'),
      to: sp.get('to'),
      /*
        전체 건수는 **달라고 할 때만** 센다. 타임라인(딜·회사·인물 상세)은 「더 보기」로
        이어 읽는 자리라 전체 수가 필요 없고, 목록 화면은 몇 건 중 몇 건인지 말해야 한다.
        늘 세면 상세 화면마다 셈 질의가 한 번씩 더 간다.
      */
      withTotal: sp.get('withTotal') === '1',
    })
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    return createActivity(session.workspaceId, session.memberId, body as unknown as ActivityInput)
  })
}
