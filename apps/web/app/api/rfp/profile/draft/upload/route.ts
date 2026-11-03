// POST /api/rfp/profile/draft/upload — 초안 문서를 보관함에 바로 올릴 서명 주소 받기
//
// 함수는 4.5MB 넘는 본문을 못 받는다(413, 함수에 닿기 전에 끊김). 회사소개서는 대개 그보다 크다.
// 그래서 바이트는 브라우저가 보관함에 바로 넣고, 이 창구는 **자리와 서명만** 준다.
//
// 보관함 쓰기 정책은 그대로 닫혀 있다(마이그레이션 250). 서명은 서버가 정한 경로 하나에만 유효하고
// 경로는 {org}/profile-draft/{uuid}.bin 한 모양이라 다른 조직·케이스 원문 자리를 못 가리킨다.

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { RFP_BUCKET } from '@/lib/rfp/db/storage'
import { planDraftUploads, type DraftFileMeta } from '@/lib/rfp/db/draft-upload'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let files: DraftFileMeta[]
  try {
    const body = (await req.json()) as { files?: unknown }
    files = readMeta(body.files)
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const plan = planDraftUploads(String(orgId), files, randomUUID)
  if (!plan.ok) return NextResponse.json(plan, { status: 400 })

  // 서명은 사람 확인(gate)과 조직 확인 뒤에만 만든다
  const admin = createAdminClient()
  const uploads = []
  for (const t of plan.targets) {
    const { data, error } = await admin.storage.from(RFP_BUCKET).createSignedUploadUrl(t.path)
    if (error || !data) {
      console.error('[rfp] 초안 올리기 주소 실패', error)
      return NextResponse.json({ error: 'upload_url_failed' }, { status: 502 })
    }
    uploads.push({ name: t.name, path: t.path, token: data.token })
  }

  return NextResponse.json({ bucket: RFP_BUCKET, uploads }, { status: 201 })
}

/** 이름과 크기만 받는다. 모양이 틀리면 던져 400 으로 간다 */
function readMeta(value: unknown): DraftFileMeta[] {
  if (!Array.isArray(value)) throw new Error('files')
  return value.map((v) => {
    const { name, size } = (v ?? {}) as Record<string, unknown>
    if (typeof name !== 'string' || typeof size !== 'number' || !Number.isFinite(size)) throw new Error('files')
    return { name, size }
  })
}
