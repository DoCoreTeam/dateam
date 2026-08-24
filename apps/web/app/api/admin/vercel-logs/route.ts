// GET /api/admin/vercel-logs — 배포 로그를 **우리 화면에서** 읽는 통로
//
// ## 왜 프록시가 필요한가
//
// Vercel 토큰은 브라우저로 나가면 안 된다(그 토큰 하나로 배포를 지울 수 있다).
// 그래서 화면은 이 라우트만 부르고, 토큰은 서버 밖으로 한 걸음도 나가지 않는다.
//
// ## 빈 목록을 조용히 돌려주지 않는다
//
// 연동이 안 된 것 · 로그가 0건인 것 · 우리가 잘라낸 것은 관리자가 해야 할 일이 전부 다르다.
// 셋 다 빈 배열로 뭉개면 화면은 "아무 일 없음"이라고 말하게 된다 — 관측 화면에서 그건 거짓말이다.

import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { readVercelConfig } from '@/lib/vercel/config'
import {
  VercelApiError,
  fetchDeployEvents,
  findLatestProductionDeployment,
  listDeployments,
} from '@/lib/vercel/api'
import { isFailure, normalizeDeployEvent, normalizeDeployment } from '@/lib/vercel/normalize'

export const dynamic = 'force-dynamic'

/** 목록 표준(§2-6)의 상한과 같다 */
const MAX_LIMIT = 100

export async function GET(req: NextRequest) {
  const gate = await requireAdminApi()
  if (gate.error) return gate.error

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any).from('org_content').select('value').eq('key', 'META').single()
  const cfg = readVercelConfig((data?.value as Record<string, unknown>) ?? {})

  if (!cfg.ok) {
    // 200 으로 돌려준다 — 이건 오류가 아니라 **아직 설정이 없는 상태**다.
    // 화면은 빨간 오류가 아니라 "설정하러 가기"를 보여 줘야 한다.
    return NextResponse.json({ items: [], configured: false, reason: cfg.reason, notice: cfg.message })
  }

  const sp = req.nextUrl.searchParams
  const kind = sp.get('kind') === 'logs' ? 'logs' : 'deployments'

  try {
    if (kind === 'deployments') {
      const limit = Math.min(Number(sp.get('limit')) || 20, MAX_LIMIT)
      const until = Number(sp.get('until')) || null
      const target = sp.get('target') === 'production' ? 'production' as const : null

      const out = await listDeployments(cfg.config, { limit, target, until })
      return NextResponse.json({
        configured: true,
        items: out.deployments.map(normalizeDeployment),
        nextCursor: out.nextCursor,
        // 커서가 제자리를 돌아 우리가 끊었다는 사실을 숨기지 않는다
        notice: out.stalled
          ? 'Vercel이 같은 페이지를 반복해서 돌려줘 여기서 멈췄습니다. 더 오래된 배포는 Vercel에서 확인해 주세요.'
          : null,
      })
    }

    // 배포 로그는 배포 하나를 지목해야 볼 수 있다 — 지정이 없으면 지금 프로덕션에 떠 있는 것
    const explicit = sp.get('deploymentId')
    const deployment = explicit ? null : await findLatestProductionDeployment(cfg.config)
    const deploymentId = explicit ?? deployment?.uid ?? null

    if (!deploymentId) {
      return NextResponse.json({
        configured: true, items: [],
        notice: '프로덕션에 배포된 것이 아직 없습니다.',
      })
    }

    const { events, capped } = await fetchDeployEvents(cfg.config, deploymentId)
    const rows = events.map(normalizeDeployEvent)
    const onlyFailures = sp.get('all') !== '1'
    const items = onlyFailures ? rows.filter(isFailure) : rows

    return NextResponse.json({
      configured: true,
      items: items.sort((a: { at: string }, b: { at: string }) => (a.at < b.at ? 1 : -1)),
      deploymentId,
      deploymentUrl: deployment?.url ?? null,
      // 몇 줄을 훑어 몇 줄이 남았는지 밝힌다 — '0건'만 보이면 안 훑은 것과 구분이 안 된다
      scanned: rows.length,
      capped,
      notice: capped
        ? `이 배포의 로그가 많아 최근 ${rows.length}줄까지만 가져왔습니다.`
        : null,
    })
  } catch (e) {
    // 화면이 읽을 수 있는 말로만 나간다. 원문 스택은 관리자에게도 아무 도움이 안 된다
    const err = e instanceof VercelApiError
      ? e
      : new VercelApiError('배포 로그를 읽지 못했습니다.', null, 'server')
    return NextResponse.json(
      { configured: true, items: [], error: { message: err.message, reason: err.reason } },
      { status: 502 },
    )
  }
}
