// POST /api/rfp/profile/draft — 회사 문서를 올려 프로필 초안 만들기
//
// 인입 파이프라인을 그대로 태운다. 별도 파서를 만들면 형식이 하나 늘 때마다 두 곳을 고쳐야 한다.
// 결과는 **draft 로만** 저장된다 — 자동으로 뽑은 값이 틀린 채 판정에 쓰이면
// 부적합의 이유가 「우리 회사 정보가 틀려서」가 되고 사용자는 그것을 영영 모른다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { parseFile } from '@/lib/rfp/parse'
import { draftProfile } from '@/lib/rfp/fit/draft'
import { saveProfile, missingForAssessment } from '@/lib/rfp/db/profile'
import { checkFileSize } from '@/lib/rfp/db/files'
import type { IrDocument } from '@/lib/rfp/ir/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** 한 번에 올릴 수 있는 문서 수 — 회사소개서·등록증·실적표면 충분하다 */
const MAX_FILES = 5

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const files = form.getAll('file').filter((f): f is File => f instanceof File)
  if (files.length === 0) return NextResponse.json({ error: 'missing_file' }, { status: 400 })
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: 'too_many_files', limit: MAX_FILES }, { status: 400 })
  }

  const docs: IrDocument[] = []
  const failed: { name: string; reason: string }[] = []
  let caseBytes = 0

  for (const file of files) {
    const size = checkFileSize({ sizeBytes: file.size, caseBytes, fileName: file.name })
    if (!size.ok) {
      failed.push({ name: file.name, reason: size.reason })
      continue
    }
    caseBytes += file.size

    const bytes = new Uint8Array(await file.arrayBuffer())
    const parsed = await parseFile({ fileId: `draft-${file.name}`, fileName: file.name, bytes })
    if (parsed.ok) docs.push(parsed.doc)
    else failed.push({ name: file.name, reason: parsed.reason })
  }

  if (docs.length === 0) {
    return NextResponse.json({ error: 'no_readable_file', failed }, { status: 422 })
  }

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const draft = draftProfile(docs, 1)

  // 초안도 **다섯 부분 전부** 저장한다. 예전에는 basic 만 넣고 인증·실적을
  // 응답에만 실어 보냈다 — 화면을 새로 고치면 그대로 사라졌다.
  let saved
  try {
    saved = await saveProfile(db as any, {
      orgId: String(orgId),
      createdBy: gate.user.id,
      // 확정 전에는 판정에 안 쓰인다
      status: 'draft',
      profile: {
        basic: draft.profile.basic,
        certifications: draft.profile.certifications,
        trackRecords: draft.profile.trackRecords,
        capabilities: draft.profile.capabilities,
        partners: draft.profile.partners,
      },
    })
  } catch {
    return NextResponse.json({ error: '초안을 저장하지 못했습니다' }, { status: 500 })
  }

  return NextResponse.json({
    profile: saved,
    // 값마다 어디서 뽑았는지 — 확인·수정이 실제로 이뤄지려면 이게 있어야 한다
    evidence: draft.evidence,
    missing: missingForAssessment(saved),
    failed,
  }, { status: 201 })
}
