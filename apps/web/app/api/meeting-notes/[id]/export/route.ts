import { NextRequest, NextResponse } from 'next/server'
import { getMeetingNote, listOrgPeople } from '@/app/(member)/meeting-notes/actions'
import { sanitizeRichHtml } from '@/components/ui/RichText'
import { sanitizeFilename } from '@/lib/ai-chat/export'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { buildMeetingExportHtml, type MeetingExportView } from '@/lib/meeting/export-html'
import { launchOptions } from '@/lib/security/headless-fetch'

export const runtime = 'nodejs'
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PuppeteerBrowser = any

const STATUS_LABEL: Record<string, string> = { draft: '작성중', final: '확정', archived: '보관' }

/** 렌더 실패를 사람이 읽을 사유로. "잠시 후 다시"로 뭉개면 영영 못 고친다. */
export function exportFailureMessage(format: 'pdf' | 'png', err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  const label = format.toUpperCase()
  // 서버리스에서 크로미움 바이너리를 못 찾는 경우 — 배포 설정 문제지 일시 장애가 아니다.
  if (raw.includes('could not find') || raw.includes('enoent') || raw.includes('executablepath') || raw.includes('spawn')) {
    return `${label} 변환기(브라우저 엔진)를 서버에서 찾지 못했습니다. 배포 설정을 확인해 주세요.`
  }
  if (raw.includes('headless render disabled')) {
    return `이 환경에서는 ${label} 내보내기가 비활성화되어 있습니다.`
  }
  if (raw.includes('timeout') || raw.includes('timed out')) {
    return `${label} 생성이 제한 시간을 넘었습니다. 회의록이 너무 길지 않은지 확인해 주세요.`
  }
  return `${label} 생성에 실패했습니다. 관리자에게 문의해 주세요.`
}

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
 * GET /api/meeting-notes/[id]/export?view=refined|original&format=pdf|png
 * 현재 탭(정제본/원본)에 맞춰 회의록을 깔끔한 문서로 렌더 → PDF 또는 PNG 다운로드.
 * 인증·RLS는 getMeetingNote(본인/조직 접근 가능 노트만) + listOrgPeople에서 강제. 외부 URL 미로드(SSRF 무관).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const url = new URL(req.url)
  const view: MeetingExportView = url.searchParams.get('view') === 'original' ? 'original' : 'refined'
  const format: 'pdf' | 'png' = url.searchParams.get('format') === 'png' ? 'png' : 'pdf'

  const note = await getMeetingNote(params.id).catch(() => null)
  if (!note) return NextResponse.json({ error: '회의록을 찾을 수 없습니다' }, { status: 404 })

  const people = await listOrgPeople().catch(() => [])
  const { members, externals } = classifyAttendees(note.attendees, note.attendee_user_ids, people)

  const html = buildMeetingExportHtml({
    title: note.title ?? '',
    meetingAtLabel: note.meeting_at ? formatKstDateTimeShort(note.meeting_at) : '일시 미지정',
    statusLabel: STATUS_LABEL[note.status] ?? note.status ?? '',
    memberAttendees: members,
    externalAttendees: externals,
    view,
    summary: note.summary ?? '',
    decisions: note.decisions ?? '',
    bodyHtml: sanitizeRichHtml(note.body ?? ''),
  })

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
    return NextResponse.json({ error: exportFailureMessage(format, err) }, { status: 500 })
  } finally {
    try { await browser?.close() } catch { /* noop */ }
  }

  const viewSuffix = view === 'refined' ? '정제본' : '원본'
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
