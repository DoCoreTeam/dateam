// POST /api/rfp/profile/draft — 회사 문서를 올려 프로필 초안 만들기
//
// 인입 파이프라인을 그대로 태운다. 별도 파서를 만들면 형식이 하나 늘 때마다 두 곳을 고쳐야 한다.
// 결과는 **draft 로만** 저장된다 — 자동으로 뽑은 값이 틀린 채 판정에 쓰이면
// 부적합의 이유가 「우리 회사 정보가 틀려서」가 되고 사용자는 그것을 영영 모른다.
//
// ## 규칙이 먼저 풀고 AI 는 남은 것만
//
// 정규식이 잡는 것(사업자번호·자본금·매출·인원·소재지·인증)은 규칙이 확실하게 푼다.
// 규칙이 못 푸는 것(**회사 이름**·기술·협력사·문장으로 흩어진 실적)만 AI 에게 묻는다 —
// 공고 분석과 같은 게이트웨이를 지나므로 등급 관문·비용 기록·전송 기록이 함께 붙는다.
//
// ## 문서 등급은 조건부 공개다
//
// 회사소개서에는 사업자번호와 인력이 들어 있다. 아무 모델에나 보낼 문서가 아니다.
// 허용된 모델이 없으면 **AI 를 건너뛰고 규칙 결과만** 돌려주며 그 사실을 함께 말한다 —
// 조용히 건너뛰면 「왜 회사 이름이 비지」를 아무도 설명하지 못한다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { parseFile } from '@/lib/rfp/parse'
import { draftProfile } from '@/lib/rfp/fit/draft'
import { unfilled, renderDocs, buildPrompt, parseAiDraft, mergeDraft } from '@/lib/rfp/fit/ai-draft'
import { callWithFallback } from '@/lib/rfp/ai/gateway'
import { recorded, notRecorded } from '@ax/ai-gateway'
import { pickModels } from '@/lib/rfp/ai/models'
import { toModels, toPolicy } from '@/lib/rfp/ai/host-providers'
import { makeHostCaller } from '@/lib/rfp/ai/host-caller'
import { getAvailableProviders } from '@/lib/ai-chat/registry'
import { createAdminClient } from '@/lib/supabase/server'
import { saveProfile, missingForAssessment } from '@/lib/rfp/db/profile'
import { checkFileSize } from '@/lib/rfp/db/files'
import { getBytes, RFP_BUCKET } from '@/lib/rfp/db/storage'
import { readDraftRefs, MAX_DRAFT_FILES } from '@/lib/rfp/db/draft-upload'
import type { IrDocument } from '@/lib/rfp/ir/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const input = await readInput(req, String(orgId))
  if (!input.ok) return NextResponse.json(input.body, { status: 400 })

  const docs: IrDocument[] = []
  const failed: { name: string; reason: string }[] = []
  try {
    let caseBytes = 0
    for (const file of input.files) {
      const bytes = await file.read()
      const size = checkFileSize({ sizeBytes: bytes.byteLength, caseBytes, fileName: file.name })
      if (!size.ok) {
        failed.push({ name: file.name, reason: size.reason })
        continue
      }
      caseBytes += bytes.byteLength

      const parsed = await parseFile({ fileId: `draft-${file.name}`, fileName: file.name, bytes })
      if (parsed.ok) docs.push(parsed.doc)
      else failed.push({ name: file.name, reason: parsed.reason })
    }
  } catch (e) {
    console.error('[rfp] 초안 원문 읽기 실패', e)
    return NextResponse.json({ error: 'upload_not_found' }, { status: 400 })
  } finally {
    // 보관함에 올린 임시 원문은 읽고 나면 지운다 — 초안은 값만 남기고 원문은 안 남긴다
    await input.cleanup()
  }

  if (docs.length === 0) {
    return NextResponse.json({ error: 'no_readable_file', failed }, { status: 422 })
  }

  const draft = draftProfile(docs, 1)

  // ── AI 는 규칙이 못 푼 칸만 ──
  const fields = unfilled(draft.profile)
  let aiSkipped: string | null = null
  if (fields.length > 0) {
    try {
      const admin = createAdminClient()
      const { data: metaRow } = await (admin as any)
        .from('org_content').select('value').eq('key', 'META').single()
      const meta = ((metaRow as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>
      const providers = getAvailableProviders(meta).map((p) => ({ id: p.id, apiKey: p.apiKey, model: p.model }))

      const { data: policyRows } = await (admin as any)
        .from('rfp_ai_models')
        .select('vendor_id, allowed_doc_classes, is_internal, no_training, zero_retention, input_krw_per_mtok, output_krw_per_mtok, multimodal, sort_order, enabled')
      const models = toModels(providers, ((policyRows ?? []) as Record<string, unknown>[]).map(toPolicy))

      // 회사소개서는 우리 내부 문서다 — 공개 전용 모델에 보내지 않는다
      const pick = pickModels(models, { docClass: 'restricted' })
      if (pick.chain.length === 0) {
        aiSkipped = 'no_model_for_doc_class'
      } else {
        const { data: orgIdForAi } = await (db as any).rpc('rfp_default_org')
        const out = await callWithFallback(pick.chain, {
          orgId: String(orgIdForAi ?? ''),
          caseId: null,
          docClass: 'restricted',
          purpose: 'profile_draft',
          prompt: buildPrompt(fields, renderDocs(docs)),
        }, {
          store: {
            async recordCall(r) {
              // 칸 이름은 표에 맞춘다. supabase-js 는 없는 칸을 던지지 않고 돌려주므로
              // 틀리면 기록이 조용히 0건이 된다
              const { error } = await (admin as any).from('rfp_llm_calls').insert({
                org_id: r.orgId, model_id: uuidOrNull(r.modelId), purpose: r.purpose,
                input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_krw: r.costKrw,
                latency_ms: r.latencyMs, status: r.ok ? 'ok' : 'error', error: r.error,
              })
              if (error) {
                console.error('[rfp] llm 호출 기록 실패', error)
                return notRecorded(`insert 실패: ${error.message ?? '알 수 없음'}`)
              }
              return recorded(`${r.orgId}:${r.purpose}`)
            },
            async recordTransfer(r) {
              const { error } = await (admin as any).from('rfp_external_transfers').insert({
                org_id: r.orgId, case_id: null, model_id: uuidOrNull(r.modelId), doc_class: r.docClass,
                purpose: r.purpose,
                // 무엇을 몇 개 가렸는지만 센다 — 값은 남기지 않는다
                token_count: Object.values(r.maskedCounts).reduce((n, v) => n + v, 0),
                redaction_applied: Object.keys(r.maskedCounts).length > 0,
              })
              if (error) {
                console.error('[rfp] 외부 전송 기록 실패', error)
                return notRecorded(`insert 실패: ${error.message ?? '알 수 없음'}`)
              }
              return recorded(`${r.orgId}:${r.purpose}`)
            },
          },
          call: makeHostCaller({ providers }),
        })

        const ai = parseAiDraft(out.text, fields)
        draft.profile = mergeDraft(draft.profile, ai)
        draft.evidence.push(...ai.evidence)
      }
    } catch (e) {
      // AI 가 실패해도 규칙 결과는 살아 있다. 통째로 실패시키면 아무것도 안 채워진다
      aiSkipped = e instanceof Error ? e.message : 'ai_failed'
    }
  }

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
    // AI 를 건너뛰었으면 그 사실을 말한다 — 조용히 건너뛰면 「왜 비지」를 설명 못 한다
    aiSkipped,
  }, { status: 201 })
}

interface DraftInputFile { name: string; read(): Promise<Uint8Array> }

type DraftInput =
  | { ok: true; files: DraftInputFile[]; cleanup(): Promise<void> }
  | { ok: false; body: Record<string, unknown> }

/**
 * 원문을 받는 길은 둘이다.
 *
 * - JSON `{ files: [{ name, path }] }`: 화면이 보관함에 먼저 올린 자리. 4.5MB 넘는 문서는 이 길뿐이다
 * - multipart `file`: CLI 와 작은 문서. 함수 본문 상한(4.5MB) 안에서만 닿는다
 *
 * 경로는 그 조직의 초안 자리만 받는다 — 아니면 남의 조직 원문 경로를 넣어 읽게 할 수 있다
 */
async function readInput(req: NextRequest, orgId: string): Promise<DraftInput> {
  const isJson = (req.headers.get('content-type') ?? '').includes('application/json')
  if (isJson) {
    let refs
    try {
      refs = readDraftRefs(orgId, ((await req.json()) as { files?: unknown }).files)
    } catch {
      refs = null
    }
    if (!refs) return { ok: false, body: { error: 'invalid_upload_ref' } }
    const admin = createAdminClient()
    return {
      ok: true,
      files: refs.map((r) => ({ name: r.name, read: () => getBytes(admin as any, r.path) })),
      async cleanup() {
        const { error } = await admin.storage.from(RFP_BUCKET).remove(refs.map((r) => r.path))
        if (error) console.error('[rfp] 초안 임시 원문 지우기 실패', error)
      },
    }
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return { ok: false, body: { error: '요청 본문을 읽지 못했습니다' } }
  }
  const files = form.getAll('file').filter((f): f is File => f instanceof File)
  if (files.length === 0) return { ok: false, body: { error: 'missing_file' } }
  if (files.length > MAX_DRAFT_FILES) return { ok: false, body: { error: 'too_many_files', limit: MAX_DRAFT_FILES } }
  return {
    ok: true,
    files: files.map((f) => ({ name: f.name, read: async () => new Uint8Array(await f.arrayBuffer()) })),
    cleanup: async () => {},
  }
}

/**
 * 기록의 model_id 는 uuid 칸이다.
 *
 * 호스트 폴백 모델(표에 없는 것)은 id 가 'gemini' 같은 이름이라 그대로 넣으면
 * **insert 가 통째로 실패하고 supabase 는 던지지 않는다** — 기록이 조용히 0건이 된다.
 */
function uuidOrNull(v: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null
}
