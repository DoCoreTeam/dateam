// app/api/ui-preferences/route.ts — 목록 개인 설정 저장
// 저장 실패가 화면 조작을 막지 않도록 클라이언트는 응답을 기다리지 않는다.
// 대신 서버가 **저장 대상만** 통과시킨다 — 임의 jsonb를 그대로 받지 않는다.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sanitizeSavedPrefs } from '@/lib/ui/list-query'
import type { Database } from '@/types/database'

type UiPreferenceRow = Database['public']['Tables']['ui_preferences']['Insert']

/**
 * 라우트 경로 **또는** 점 네임스페이스만 허용 — 남의 키를 덮어쓰거나 길이로 테이블을 늘리지 못하게.
 *
 * 예전엔 슬래시로 시작하는 라우트 경로만 받았다. 그런데 **한 부품을 두 화면이 함께 쓰는 경우**
 * (홈과 /calendar 의 CalendarBoard)는 라우트가 둘이라 경로를 키로 쓸 수 없어 `calendar.board`
 * 같은 네임스페이스를 쓴다. 그 키가 400 으로 튕기면서 v0.7.613 「보기 기억」은
 * **한 번도 저장된 적이 없었다** — 클라이언트가 실패를 조용히 삼켜 아무도 몰랐다
 * (실측 v0.7.617: GET/POST 둘 다 400).
 */
function sanitizeScopeKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  if (/^\/[\w\-/[\]().]{0,120}$/.test(key)) return key
  if (/^[a-z][a-z0-9]*(\.[a-z0-9]+){1,3}$/.test(key)) return key
  return null
}

/**
 * 저장 대상만 통과시킨다 — 임의 jsonb 를 그대로 받지 않는다.
 * 목록 화면(`/...`)은 목록 표준의 sanitizer 를, 목록이 아닌 표면은 **보기 슬러그 하나만** 남긴다.
 * (목록 sanitizer 의 허용값은 table·card·compact 뿐이라 캘린더의 month·week·day 가 통째로 버려졌다)
 */
const NON_LIST_VIEWS = new Set(['month', 'week', 'day'])

function sanitizeValueFor(scopeKey: string, raw: unknown) {
  if (scopeKey.startsWith('/')) return sanitizeSavedPrefs(raw)
  const view = (raw as { view?: unknown } | null | undefined)?.view
  return typeof view === 'string' && NON_LIST_VIEWS.has(view) ? { view } : {}
}

export async function GET(request: Request) {
  const scopeKey = sanitizeScopeKey(new URL(request.url).searchParams.get('scopeKey'))
  if (!scopeKey) return NextResponse.json({ error: '조회 대상 화면이 올바르지 않습니다' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  const { data } = await supabase
    .from('ui_preferences').select('value')
    .eq('user_id', user.id).eq('scope_key', scopeKey).maybeSingle()

  // 못 읽어도 화면은 기본값으로 돈다 — 설정 조회가 목록을 막지 않는다
  return NextResponse.json({ value: sanitizeValueFor(scopeKey, (data as { value?: unknown } | null)?.value) })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다' }, { status: 400 })
  }

  const { scopeKey: rawKey, value } = (body ?? {}) as { scopeKey?: unknown; value?: unknown }
  const scopeKey = sanitizeScopeKey(rawKey)
  if (!scopeKey) return NextResponse.json({ error: '저장 대상 화면이 올바르지 않습니다' }, { status: 400 })

  const row: UiPreferenceRow = {
    user_id: user.id,
    scope_key: scopeKey,
    value: sanitizeValueFor(scopeKey, value),
    updated_at: new Date().toISOString(),
  }
  // 이 저장소의 supabase 클라이언트는 쓰기 경로 타입이 풀리지 않아 레포 전역이 캐스팅을 쓴다.
  // 대신 payload(row)는 위에서 Insert 타입으로 못 박아 두었다 — 캐스팅이 값 검증을 건너뛰지 않는다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { error } = await db.from('ui_preferences').upsert(row, { onConflict: 'user_id,scope_key' })

  if (error) {
    console.error('[ui-preferences] 저장 실패', { scopeKey, code: error.code, message: error.message })
    return NextResponse.json({ error: '설정을 저장하지 못했습니다' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
