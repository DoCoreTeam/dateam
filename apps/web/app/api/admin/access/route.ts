import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { saveGrant, removeGrant } from '@/app/admin/access/actions'

/**
 * 접근권한 부여 창구 — **관리자만** (LOOP.md 7절 S2)
 *
 * 밑에서 도는 것은 `createAdminClient` 다. 서비스롤은 RLS 를 통째로 지나가고,
 * `access_grant` 는 정책이 0개라 **이 창구가 유일한 문**이다. 그래서 문 바로 앞에
 * 사람 확인(`requireAdminApi`)을 둔다. 없으면 로그인한 아무나 자기에게 문을 열 수 있다.
 *
 * 값 검사는 여기 적지 않는다. `app/admin/access/actions.ts` 의 `validateGrant` 한 벌이
 * 표면 키와 주체 id 를 등재부·실제 행과 대조한다. 창구가 따로 검사하면 두 벌이 되고
 * 한쪽만 고쳐지는 날이 온다.
 */

export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '본문을 읽지 못했습니다' }, { status: 400 })
  }

  const input = body as Record<string, unknown>
  const failed = await saveGrant(
    {
      surfaceKey: String(input.surfaceKey ?? ''),
      subjectKind: String(input.subjectKind ?? ''),
      subjectId: String(input.subjectId ?? ''),
      effect: String(input.effect ?? ''),
      includeDescendants: input.includeDescendants !== false,
    },
    auth.user.id,
  )
  if (failed) return NextResponse.json({ error: failed }, { status: 400 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: '지울 부여를 지정하지 않았습니다' }, { status: 400 })

  const failed = await removeGrant(id)
  if (failed) return NextResponse.json({ error: failed }, { status: 400 })
  return NextResponse.json({ ok: true })
}
