// GET  /api/rfp/profile — 우리 조직의 활성 프로필 (자식까지)
// PUT  /api/rfp/profile — 프로필 저장 (새 버전으로)
//
// 고칠 때마다 **새 버전**을 만든다. 덮어쓰면 지난 판정이 왜 그랬는지 설명할 수 없다 —
// 「그때는 인증이 없었다」를 보여 주려면 그때의 프로필이 남아 있어야 한다.
//
// 읽고 쓰는 것은 **다섯 부분 전부**다(기본정보·인증·실적·기술·협력사).
// 예전에는 기본정보만 저장해서, 적합도를 실제로 가르는 넷이 화면에도 표에도 없었다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { loadProfile, saveProfile, normalizeProfileInput, missingForAssessment } from '@/lib/rfp/db/profile'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  try {
    // 활성 판이 없으면 초안이라도 준다 — 초안까지 안 주면 사용자가 쓰던 것이 사라져 보인다
    const active = await loadProfile(db as any, { status: 'active' })
    const profile = active ?? await loadProfile(db as any)
    return NextResponse.json({
      profile,
      missing: profile ? missingForAssessment(profile) : [],
    })
  } catch {
    return NextResponse.json({ error: '프로필을 불러오지 못했습니다' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const input = normalizeProfileInput(body)
  // 이름 없이 확정하면 판정 결과가 어느 회사 것인지 알 수 없다
  if (!input.basic.companyName) {
    return NextResponse.json({ error: 'missing_company_name' }, { status: 400 })
  }

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  // 초안으로만 저장할 수도 있다 — 자동으로 뽑은 값을 확인 전에 판정에 쓰지 않으려면 필요하다
  const status = (body as Record<string, unknown>)?.status === 'draft' ? 'draft' : 'active'

  try {
    const saved = await saveProfile(db as any, {
      orgId: String(orgId),
      createdBy: gate.user.id,
      status,
      profile: {
        basic: input.basic,
        certifications: input.certifications,
        trackRecords: input.trackRecords,
        capabilities: input.capabilities,
        partners: input.partners,
      },
    })
    return NextResponse.json({ profile: saved, missing: missingForAssessment(saved) }, { status: 201 })
  } catch {
    return NextResponse.json({ error: '프로필을 저장하지 못했습니다' }, { status: 500 })
  }
}
