import { ok, fail, failUnexpected } from '@/lib/ci/api'
import { runDiscovery } from '@/lib/ci/jobs/stages'
import { createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 300

/**
 * 발견 배치 실행 — 내부 전용(서비스 토큰).
 *
 * 왜 있나: 지금까지 발견을 돌리는 길은 **트렌드 화면의 버튼 하나뿐**이었다.
 * 그런데 주제 8개 × 대조 30건 × 간격 3.2초면 최소 13분이라, 사람이 브라우저 앞에서
 * 기다릴 수 있는 일이 아니다. 스케줄러가 조금씩 나눠 돌 수 있어야 한다.
 *
 * 예산을 인자로 받는 이유: AI 호출 한도가 유한하다. "이번엔 여기까지"를
 * 부르는 쪽이 정해야 남은 예산을 다른 기능이 쓸 수 있다.
 *
 * 인증: CI_WORKER_TOKEN. 토큰이 없으면 통과시키지 않는다 —
 * "설정 안 했으니 통과"는 AI 예산을 외부에 열어주는 것과 같다.
 */
export async function POST(req: Request) {
  const expected = process.env.CI_WORKER_TOKEN
  if (!expected) return fail('INTERNAL', '워커 토큰(CI_WORKER_TOKEN)이 설정되지 않았습니다')
  if (req.headers.get('Authorization') !== `Bearer ${expected}`) {
    return fail('UNAUTHORIZED', '워커 토큰이 올바르지 않습니다')
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      workspaceId?: string
      maxSetsPerTopic?: number
      topicIds?: string[]
    }

    let workspaceId = body.workspaceId
    if (!workspaceId) {
      // 워크스페이스를 안 주면 첫 번째를 쓴다 — 지금 운영은 단일 워크스페이스다.
      const adminClient = createAdminClient() as unknown as {
        from: (t: string) => { select: (c: string) => { limit: (n: number) => Promise<{ data: { id: string }[] | null }> } }
      }
      const { data } = await adminClient.from('ci_workspaces').select('id').limit(1)
      workspaceId = data?.[0]?.id
    }
    if (!workspaceId) return fail('NOT_FOUND', '워크스페이스를 찾지 못했습니다')

    const result = await runDiscovery(workspaceId, {
      maxSetsPerTopic: body.maxSetsPerTopic,
      topicIds: body.topicIds,
    })

    // 실패를 성공으로 위장하지 않는다 — 0건과 "못 돌았다"는 다른 사실이다.
    if (!result.ok) {
      return fail('INTERNAL', [result.errorMessage, result.note].filter(Boolean).join(' · '))
    }
    return ok({ workspaceId, ran: true, note: result.note ?? null })
  } catch (e) {
    return failUnexpected(e)
  }
}
