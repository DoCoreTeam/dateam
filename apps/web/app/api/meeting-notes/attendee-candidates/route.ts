// GET /api/meeting-notes/attendee-candidates?q=김시홍
//
// 회의노트가 CRM 인물·회사를 찾아보는 창구.
//
// **왜 CRM API 를 직접 안 부르나**: 회의노트는 호스트(사내 업무) 쪽 화면이라
// CRM 의 워크스페이스 개념을 모른다. `lib/crm/link/candidates.ts` 가 그 한 겹을 감싸고,
// 조회가 실패해도 회의노트는 그대로 돌아간다 — 곁들이는 일이 본 일을 막으면 안 된다.
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadAttendeeCandidates, loadAttendeePeopleByIds } from '@/lib/crm/link/candidates'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  /**
   * `ids` 는 **이미 이어 둔 사람**을 되살릴 때 쓴다 — 회의노트를 다시 열면
   * 저장된 것은 인물 id 뿐이라, 이름과 소속을 여기서 되찾아야 칩을 그릴 수 있다.
   */
  const ids = req.nextUrl.searchParams.get('ids')?.split(',').map((s) => s.trim()).filter(Boolean) ?? []
  if (ids.length > 0) {
    return NextResponse.json(await loadAttendeePeopleByIds(ids))
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  // 한 글자로 부르면 후보가 수백 건이라 화면이 못 읽는다. 두 글자부터 찾는다
  if (q.length > 0 && q.length < 2) {
    return NextResponse.json({ people: [], companies: [] })
  }

  const candidates = await loadAttendeeCandidates(q || undefined)
  return NextResponse.json(candidates)
}
