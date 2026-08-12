// app/api/ui-preferences/route.ts — 목록 개인 설정 저장
// 저장 실패가 화면 조작을 막지 않도록 클라이언트는 응답을 기다리지 않는다.
// 대신 서버가 **저장 대상만** 통과시킨다 — 임의 jsonb를 그대로 받지 않는다.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sanitizeSavedPrefs } from '@/lib/ui/list-query'
import type { Database } from '@/types/database'

type UiPreferenceRow = Database['public']['Tables']['ui_preferences']['Insert']

/** 라우트 경로만 허용 — 남의 키를 덮어쓰거나 길이로 테이블을 늘리지 못하게 */
function sanitizeScopeKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  if (!/^\/[\w\-/[\]().]{0,120}$/.test(key)) return null
  return key
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
  return NextResponse.json({ value: sanitizeSavedPrefs((data as { value?: unknown } | null)?.value) })
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
    value: sanitizeSavedPrefs(value),
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
