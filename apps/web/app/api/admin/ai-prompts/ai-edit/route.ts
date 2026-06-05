import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { getGeminiConfig, callGeminiOnce, loadSchemaDigest } from '@/lib/gpu/extract-helpers'

// 축6: 관리자가 지시문을 주면 AI가 현재 프롬프트를 개선해 반환(저장은 별도 — 검토 후 사람이 저장).
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const body = await req.json().catch(() => ({}))
  const content = typeof body.content === 'string' ? body.content : ''
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
  if (!content || !instruction) return NextResponse.json({ error: '현재 내용·지시문 필요' }, { status: 400 })

  const admin = createAdminClient()
  const { apiKey, model } = await getGeminiConfig(admin)
  if (!apiKey) return NextResponse.json({ error: 'Gemini API 키 미설정(시스템 설정)' }, { status: 400 })

  try {
    const schema = await loadSchemaDigest(admin)
    const meta = `당신은 데이터 추출 프롬프트를 개선하는 전문가입니다.
아래 [현재 프롬프트]를 [관리자 지시]에 맞게 수정하세요. [DB 스키마]를 참고해 실제 테이블·필드명과 정합하게 유지하세요.
규칙: 출력은 개선된 프롬프트 본문만(설명·코드펜스 없이). 기존에 잘 동작하던 필드 추출 지시는 함부로 삭제하지 말 것.

[관리자 지시]
${instruction}

[DB 스키마]${schema}

[현재 프롬프트]
${content}`
    const revised = (await callGeminiOnce(apiKey, model, meta, false)).trim()
    if (!revised || revised.length < 30) return NextResponse.json({ error: 'AI 응답이 비었습니다' }, { status: 502 })
    return NextResponse.json({ revised })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'AI 편집 실패' }, { status: 502 })
  }
}
