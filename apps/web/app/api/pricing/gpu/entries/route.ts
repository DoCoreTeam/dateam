// POST /api/pricing/gpu/entries — 견적과 시세를 정해진 칸으로 여러 줄 넣는다
//
// body: { rows: [{ kind, vendor, product_id, amount, currency, basis, period, term, received_on, source }] }
//   칸의 뜻과 허용 값은 lib/gpu/entry.ts, 한 번에 최대 MAX_ENTRY_ROWS 줄
// 관리자가 넣으면 바로 확정되어 표에 반영, 일반 회원이 넣으면 확정 대기
// 칸이 하나라도 틀리면 아무것도 저장하지 않고 400 과 틀린 칸(줄 번호, 칸 이름, 까닭)을 돌려준다
// 화면 /pricing/gpu 의 입력 창과 teamda gpu entry create 가 이 창구 하나를 쓴다

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { createEntries } from '@/lib/gpu/entry-store'
import { MAX_ENTRY_ROWS, type EntryField } from '@/lib/gpu/entry'

interface EntriesBody {
  rows: Array<Record<EntryField, unknown>>
}

export async function POST(req: Request) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const body = (await req.json().catch(() => null)) as EntriesBody | null
  const rows = body && Array.isArray(body.rows) ? body.rows : null
  if (!rows || rows.length === 0 || rows.length > MAX_ENTRY_ROWS) {
    return NextResponse.json({ error: `rows 는 1~${MAX_ENTRY_ROWS}줄입니다` }, { status: 400 })
  }
  try {
    const result = await createEntries(await createClient(), createAdminClient(), {
      name: auth.user.email ?? auth.user.id,
      isAdmin: auth.user.role === 'admin',
    }, rows)
    if (!result.ok) {
      const error = result.error === 'invalid' ? '칸이 틀린 줄이 있어 저장하지 않았습니다' : '환율을 읽지 못해 저장하지 않았습니다'
      return NextResponse.json({ error, code: result.error, errors: result.errors ?? [] }, { status: result.status })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[pricing/gpu/entries]', err)
    return NextResponse.json({ error: '저장하지 못했습니다' }, { status: 500 })
  }
}
