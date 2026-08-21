// POST /api/admin/system-log/remedy — 이 지문의 **해결 방법**을 준다
//
// ## 안전장치 넷 (이 순서가 곧 설계다)
//
// ① **요청형** — 화면을 열 때 자동으로 부르지 않는다. 로그 100줄이 곧 AI 100회가 되면
//    관측 도구가 한도를 태우는 자기모순이 된다.
// ② **지문당 1회** — 같은 오류 500건에 500번 부르지 않는다. PK 가 fingerprint 라 구조적으로 막힌다.
// ③ **한도(quota)·키·설정·DB 사유에는 AI 를 안 부른다** — 또 실패한다.
//    그때가 답이 가장 필요한 순간이라, 우리가 미리 쓴 **정적 플레이북**이 답한다.
// ④ **자동 실행 없음** — 조치는 읽을거리다. 근거가 없으면 "모르겠다"고 말하게 한다.

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { playbookFor, shouldAskAi, type Remedy } from '@/lib/system-log/playbook'
import { callGeminiJson } from '@/lib/ai/gemini-call'
import { readGeminiKey } from '@/lib/ai/gemini-key'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: { message: '로그인이 필요합니다.' } }, { status: 401 })

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = admin as any

  const { data: profile } = await adm.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: { message: '관리자만 볼 수 있습니다.' } }, { status: 403 })
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* 빈 것으로 본다 */ }
  const fingerprint = String(body.fingerprint ?? '').trim()
  if (!fingerprint) {
    return NextResponse.json({ error: { message: '어느 사건인지 알 수 없습니다.' } }, { status: 400 })
  }

  // ② 이미 있으면 그대로 준다 — 같은 지문을 두 번 묻지 않는다
  const { data: cached } = await adm.from('system_event_remedies')
    .select('fingerprint,created_at,model,confidence,body,is_playbook')
    .eq('fingerprint', fingerprint).maybeSingle()
  if (cached) {
    return NextResponse.json({ remedy: cached.body, model: cached.model, cached: true,
      isPlaybook: cached.is_playbook, createdAt: cached.created_at })
  }

  // 최근 사건 하나를 근거로 삼는다 — 원문 없이 물으면 "일반적인 조언"만 돌아온다
  const { data: sample } = await adm.from('system_events')
    .select('source,reason,feature,route,headline,detail,raw')
    .eq('fingerprint', fingerprint)
    .order('occurred_at', { ascending: false }).limit(1).maybeSingle()
  if (!sample) {
    return NextResponse.json({ error: { message: '이 사건의 기록을 찾지 못했습니다.' } }, { status: 404 })
  }

  // ③ 우리가 답을 아는 사유는 AI 를 부르지 않는다
  const playbook = playbookFor(sample.reason)
  if (playbook || !shouldAskAi(sample.reason)) {
    const remedy = playbook as Remedy
    await adm.from('system_event_remedies').insert({
      fingerprint, model: null, confidence: remedy.confidence,
      body: remedy, is_playbook: true,
    })
    return NextResponse.json({ remedy, model: null, cached: false, isPlaybook: true })
  }

  const apiKey = await readGeminiKey(adm)
  if (!apiKey) {
    return NextResponse.json({
      error: { message: 'AI 키가 없어 해결 방법을 만들지 못했습니다. 시스템 설정 → 통합에서 키를 등록해 주세요.' },
    }, { status: 400 })
  }

  /**
   * ④ **우리 맥락을 준다.** 안 주면 "로그를 확인하세요" 같은 일반론이 나온다.
   * 그리고 모르면 모른다고 하게 만든다 — 그럴듯한 오답이 관리자를 엉뚱한 데로 보낸다.
   */
  const prompt = [
    '당신은 Next.js 14 + Supabase(Postgres) + Prisma 로 만든 사내 업무 시스템의 운영 담당자입니다.',
    '아래는 그 시스템에서 실제로 난 오류입니다. **한국어**로, 관리자가 바로 할 수 있는 말로 답하세요.',
    '',
    `발생 위치: ${sample.source}${sample.feature ? ` / ${sample.feature}` : ''}${sample.route ? ` / ${sample.route}` : ''}`,
    `자동 분류된 사유: ${sample.reason}`,
    `요약: ${sample.headline} — ${sample.detail}`,
    '원문:',
    (sample.raw ?? '').slice(0, 1500),
    '',
    '규칙:',
    '- 원문에 근거가 없으면 지어내지 말고 confidence 를 "unknown" 으로 두고 그렇게 말하세요.',
    '- 조치는 **읽을거리**입니다. 자동으로 실행되지 않습니다. 되돌릴 수 없는 조치는 reversible:false 로 표시하세요.',
    '- 파일 경로를 추측해서 적지 마세요. 원문에 나온 것만 적으세요.',
    '',
    'JSON 으로만 답하세요:',
    '{"diagnosis":"한 문장","confidence":"high|low|unknown",',
    ' "checks":["확인할 것"],',
    ' "actions":[{"what":"조치","risk":"safe|careful","reversible":true}],',
    ' "files":["원문에 나온 경로"]}',
  ].join('\n')

  try {
    const result = await callGeminiJson({ prompt, apiKey, model: null, feature: 'system-log-remedy' })
    const parsed = (result.value ?? {}) as Record<string, unknown>
    const remedy: Remedy = {
      diagnosis: String(parsed.diagnosis ?? '원인을 알아내지 못했습니다.'),
      confidence: (['high', 'low', 'unknown'] as const).includes(parsed.confidence as never)
        ? (parsed.confidence as Remedy['confidence']) : 'unknown',
      checks: Array.isArray(parsed.checks) ? parsed.checks.map(String).slice(0, 8) : [],
      actions: Array.isArray(parsed.actions)
        ? (parsed.actions as Record<string, unknown>[]).slice(0, 8).map((a) => ({
          what: String(a.what ?? ''),
          risk: (a.risk === 'careful' ? 'careful' : 'safe') as 'careful' | 'safe',
          reversible: a.reversible !== false,
        })).filter((a) => a.what)
        : [],
      files: Array.isArray(parsed.files) ? parsed.files.map(String).slice(0, 8) : [],
      isPlaybook: false,
    }

    await adm.from('system_event_remedies').insert({
      fingerprint, model: result.model, confidence: remedy.confidence,
      body: remedy, is_playbook: false,
    })
    return NextResponse.json({ remedy, model: result.model, cached: false, isPlaybook: false })
  } catch (e) {
    // 여기서 실패해도 **사실 문장은 화면에 그대로 있다** — 그게 이 설계의 요점이다
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({
      error: { message: `해결 방법을 만들지 못했습니다: ${msg}` },
    }, { status: 502 })
  }
}
