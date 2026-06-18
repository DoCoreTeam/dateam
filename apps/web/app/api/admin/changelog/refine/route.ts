import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { getGeminiConfig, callGeminiOnce } from '@/lib/gpu/extract-helpers'
import { buildRefinePrompt, parseRefineOutput } from '@/lib/changelog/refine-prompt'
import { sanitizeChanges, isVersionLike } from '@/lib/changelog/normalize'

// POST /api/admin/changelog/refine — 커밋 원문을 기능 단위 사용자 친화 콘텐츠로 AI 정제(미리보기 반환, 저장 X).
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  let body: { version?: unknown; rawLines?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '잘못된 요청' }, { status: 400 }) }

  const rawV = typeof body.version === 'string' ? body.version.trim().slice(0, 40) : ''
  const version = isVersionLike(rawV) ? rawV : ''   // 프롬프트 본문 일관 검증(다른 라우트와 동일)
  const rawLines = Array.isArray(body.rawLines)
    ? body.rawLines.filter((l): l is string => typeof l === 'string').map((l) => l.slice(0, 500)).slice(0, 50)
    : []
  if (rawLines.length === 0) return NextResponse.json({ error: '정제할 원문이 없습니다' }, { status: 400 })

  const admin = createAdminClient()
  const config = await getGeminiConfig(admin)
  if (!config.apiKey) return NextResponse.json({ error: 'AI 키 미설정' }, { status: 500 })

  // 이미 게시된 내역을 톤·형식 참고로(few-shot) — 일관성. 최신 5건.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pub, error: pubErr } = await (admin as any)
    .from('app_releases').select('title, changes')
    .eq('is_published', true).order('released_at', { ascending: false, nullsFirst: false }).limit(5)
  if (pubErr) console.error('[changelog/refine] few-shot 조회 실패(무시하고 진행):', pubErr.message)
  const examples = (pub ?? []).map((r: { title: string | null; changes: unknown }) => ({
    title: typeof r.title === 'string' ? r.title : '',
    changes: Array.isArray(r.changes) ? (r.changes as { text?: unknown }[]).map((c) => (typeof c?.text === 'string' ? c.text : '')).filter(Boolean) : [],
  }))

  try {
    const out = parseRefineOutput(await callGeminiOnce(config.apiKey, config.model, buildRefinePrompt({ version, rawLines, examples }), true))
    return NextResponse.json({ refined: { title: out.title, changes: sanitizeChanges(out.changes) } })
  } catch (e) {
    console.error('[changelog/refine] error:', e)
    return NextResponse.json({ error: 'AI 정제 중 오류가 발생했습니다' }, { status: 502 })
  }
}
