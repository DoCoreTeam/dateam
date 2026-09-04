import { NextRequest, NextResponse } from 'next/server'
import { getMeetingNote, listOrgPeople } from '@/app/(member)/meeting-notes/actions'
import { sanitizeRichHtml } from '@/components/ui/RichText'
import { sanitizeFilename } from '@/lib/ai-chat/export'
import { formatKstDateTimeKorean } from '@/lib/datetime/kst'
import { exportFailureMessage } from '@/lib/meeting/export-failure'
import { buildMeetingExportHtml, type MeetingExportView, type ExportDigest } from '@/lib/meeting/export-html'
import { createClient } from '@/lib/supabase/server'
import { listTranscriptSegments, formatSegmentTime } from '@/lib/meeting/transcript'
import { listMeetingDigests } from '@/lib/meeting/digest-run'
import { FACT_ORIGIN_LABEL } from '@/lib/meeting/digest-prompt'
import { launchOptions } from '@/lib/security/headless-fetch'
import { recordSystemEvent } from '@/lib/system-log/record'

export const runtime = 'nodejs'
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PuppeteerBrowser = any

/** 회의 참석자 분류 — user_ids→조직원(이름 매칭), 그 외 attendees→외부. MeetingDetailClient와 동일 규칙. */
function classifyAttendees(
  attendees: string | null,
  userIds: string[] | null,
  people: { id: string; name: string }[],
): { members: string[]; externals: string[] } {
  const byId = new Map(people.map((p) => [p.id, p.name] as const))
  const members: string[] = []
  const memberNames = new Set<string>()
  for (const id of userIds ?? []) {
    const name = byId.get(id)
    if (name) { members.push(name); memberNames.add(name) }
  }
  const externals = (attendees ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((n) => n && !memberNames.has(n))
  return { members, externals }
}

/**
 * GET /api/meeting-notes/[id]/export?view=refined|original|digest|transcript&format=pdf|png
 * 현재 탭(정제본/원본)에 맞춰 회의록을 깔끔한 문서로 렌더 → PDF 또는 PNG 다운로드.
 * 인증·RLS는 getMeetingNote(본인/조직 접근 가능 노트만) + listOrgPeople에서 강제. 외부 URL 미로드(SSRF 무관).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const url = new URL(req.url)
  /**
   * 담을 것 — 모르는 값이 오면 기존 기본값(정제본)으로 떨어진다.
   * 손으로 나열하지 않고 배열에 담는다: 뷰가 하나 늘 때마다 여기를 고쳐야 하는 손목록이 되지 않게.
   */
  const rawView = url.searchParams.get('view')
  const view: MeetingExportView =
    (['original', 'digest', 'transcript'] as const).find((v) => v === rawView) ?? 'refined'
  const rawFormat = url.searchParams.get('format')
  // html = 미리보기. 실제 산출물과 같은 빌더를 쓰므로 "본 것과 받는 것"이 어긋날 수 없다(브라우저 렌더 불필요).
  const isPreview = rawFormat === 'html'
  const format: 'pdf' | 'png' = rawFormat === 'png' ? 'png' : 'pdf'

  const note = await getMeetingNote(params.id).catch(() => null)
  if (!note) return NextResponse.json({ error: '회의록을 찾을 수 없습니다' }, { status: 404 })

  const people = await listOrgPeople().catch(() => [])
  const { members, externals } = classifyAttendees(note.attendees, note.attendee_user_ids, people)
  // 작성자·부서는 회의록 문서의 필수 표기다. 못 찾으면 빈 문자열 — 빌더가 그 행을 통째로 뺀다(지어내지 않는다).
  const authorName = people.find((p) => p.id === note.user_id)?.name ?? ''

  /*
    담을 것을 **실제로 읽어 온다.** 뷰만 늘리고 데이터를 안 실으면 문서는 비어 나가고,
    그건 "내보내기가 생겼다"가 아니라 "빈 파일이 생겼다"이다.
    권한 판정은 RLS 클라이언트에 맡긴다 — 여기서 규칙을 다시 쓰면 두 벌이 된다.
  */
  const supabase = view === 'transcript' || view === 'digest' ? await createClient() : null
  const segments = view === 'transcript' && supabase
    ? (await listTranscriptSegments(supabase, params.id).catch(() => []))
      .map((sg) => ({ timeLabel: formatSegmentTime(sg.startMs), speaker: sg.speaker, text: sg.text }))
    : undefined
  let digest: ExportDigest | null = null
  if (view === 'digest' && supabase) {
    const latest = (await listMeetingDigests(supabase, params.id).catch(() => []))[0] ?? null
    if (latest) {
      digest = {
        outcome: latest.digest.outcome,
        nextStep: latest.digest.nextStep,
        agenda: latest.digest.agenda.map((a) => ({
          title: a.title,
          facts: a.facts.map((f) => ({ text: f.text, originLabel: FACT_ORIGIN_LABEL[f.origin] })),
        })),
        decisions: latest.digest.decisions.map((d) => ({ text: d.text, originLabel: FACT_ORIGIN_LABEL[d.origin] })),
        conflicts: latest.digest.conflicts.map((c) => ({ memo: c.memo, transcript: c.transcript })),
      }
    }
  }

  const html = buildMeetingExportHtml({
    title: note.title ?? '',
    meetingAtLabel: note.meeting_at ? formatKstDateTimeKorean(note.meeting_at) : '일시 미지정',
    authorName: authorName,
    memberAttendees: members,
    externalAttendees: externals,
    view,
    summary: note.summary ?? '',
    decisions: note.decisions ?? '',
    bodyHtml: sanitizeRichHtml(note.body ?? ''),
    segments,
    digest,
  })

  // 미리보기는 여기서 끝 — 브라우저 엔진을 띄우지 않는다(빠르고, 엔진이 죽어도 미리보기는 뜬다).
  if (isPreview) {
    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

  let browser: PuppeteerBrowser = null
  let bytes: Uint8Array
  try {
    const puppeteer = (await import('puppeteer-core')).default
    const opt = await launchOptions()
    browser = await puppeteer.launch({ args: opt.args, executablePath: opt.executablePath, headless: opt.headless })
    const page = await browser.newPage()
    if (format === 'png') {
      // 문서 폭 고정 + 레티나(2x)로 선명한 이미지. .doc 엘리먼트만 캡처해 내용에 딱 맞게 크롭(하단 여백 제거).
      await page.setViewport({ width: 760, height: 1120, deviceScaleFactor: 2 })
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      const el = await page.$('.doc')
      bytes = el
        ? await el.screenshot({ type: 'png' })
        : await page.screenshot({ fullPage: true, type: 'png' })
    } else {
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      bytes = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '24px', bottom: '24px', left: '24px', right: '24px' } })
    }
  } catch (err) {
    // 원문을 삼키면 원인을 영영 못 찾는다 — 서버 로그에 남기고, 화면에는 사람이 읽을 사유를 준다.
    console.error('[meeting-notes/export] render failed', { format, view, noteId: params.id, err })
    // 이 경로는 프로덕션에서만 죽은 전례가 있다(배포본 누락) — 콘솔은 서버 로그에만 남아
    // 아무도 안 본다. 시스템 로그에 남겨야 관리자가 「무엇이 왜 안 되는지」를 알 수 있다.
    await recordSystemEvent({
      source: 'host_api', error: err, feature: `meeting-note-export:${format}`,
      route: '/api/meeting-notes/[id]/export', blocksUser: true,
      context: { format, view, noteId: params.id },
    }).catch(() => { /* 기록 실패가 응답을 막지 않는다 */ })
    return NextResponse.json({ error: exportFailureMessage(format, err) }, { status: 500 })
  } finally {
    try { await browser?.close() } catch { /* noop */ }
  }

  const VIEW_SUFFIX: Record<MeetingExportView, string> = {
    refined: '정제본', original: '원본', digest: '정리', transcript: '받아적은내용',
  }
  const viewSuffix = VIEW_SUFFIX[view]
  const base = sanitizeFilename(`${note.title || '회의록'}_${viewSuffix}`)
  const ext = format === 'png' ? 'png' : 'pdf'
  const asciiFallback = (base.replace(/[^\x20-\x7e]/g, '_').replace(/_+/g, '_') || 'meeting') + '.' + ext
  const encoded = encodeURIComponent(`${base}.${ext}`)
  const disposition = `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': format === 'png' ? 'image/png' : 'application/pdf',
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    },
  })
}
