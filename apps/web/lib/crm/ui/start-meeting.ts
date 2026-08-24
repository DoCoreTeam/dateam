/**
 * 미팅 시작 — SSOT
 *
 * **왜 이 파일이 생겼나**: 사용자 지시(2026-08-24) —
 * *"미팅기록 누르면 직접작성 누르면 화면이 또 다르고 왜 화면을 여러번 전환하게 하는거야?
 *   단일 화면에서 다 움직이게 해야지 미팅 갔는데 화면이 이리저리 전환 되면 안되는거야"*.
 *
 * 예전 경로는 **목록 → /crm/meetings/new → /crm/meetings/{id}** 로 세 화면이었다.
 * 가운데 화면이 하는 일(제목·시각·회사·딜·장소를 묻고 진입 방식을 고르게 함)은
 * 전부 작업대(`/crm/meetings/{id}`)가 이미 할 수 있는 일이다 —
 * 녹음·직접 쓰기·붙여넣기는 `MeetingWorkbench` 안에 있고, 나머지는 상세의 "이 미팅은" 패널이다.
 * 그래서 가운데를 없애고 **목록에서 곧장 작업대로** 간다. 회의 중 전환은 0회가 된다.
 *
 * 진입점이 셋(목록 버튼 · 목록 빈 상태 · 딜/회사의 미팅 패널)이라 여기 한 곳에 둔다.
 * 화면마다 fetch 를 복붙하면 기본 제목·시각 규칙이 갈리고, 그러면 어디서 시작했느냐에 따라
 * 미팅 이름이 달라진다(§재사용·단일구현 정책).
 */

import { kstParts, kstTodayKey } from '../../datetime/kst.ts'

/**
 * 제목을 안 물어보고 시작한다 — 회의는 이미 시작됐고 사용자는 녹음 버튼을 찾고 있다.
 * 비워 두면 목록에서 서로 구분이 안 되므로 날짜를 넣는다. 작업대에서 언제든 고칠 수 있다.
 */
export function defaultMeetingTitle(dateKey: string): string {
  const [, m, d] = dateKey.split('-')
  return `${Number(m)}/${Number(d)} 미팅`
}

/**
 * 지금 이 순간의 KST 벽시계.
 *
 * 예전 캡처 화면은 시각 기본값이 **`14:00` 고정**이었다. 폼을 먼저 채우는 흐름이라
 * 사람이 고칠 것을 전제한 값인데, 이제는 안 묻고 시작하므로 고정값을 두면
 * 오전 9시 회의가 전부 오후 2시로 기록된다.
 */
export function nowKstWall(now: Date = new Date()): { date: string; time: string } {
  const p = kstParts(now.toISOString())
  if (!p) return { date: kstTodayKey(now), time: '09:00' }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  }
}

export interface StartMeetingInput {
  /** 딜 상세에서 시작하면 그 딜이 물려 온다 */
  dealId?: string | null
  /** 회사 상세에서 시작하면 그 회사가 물려 온다 */
  companyId?: string | null
  /** 테스트에서 시각을 고정하기 위한 자리 */
  now?: Date
}

export interface StartedMeeting {
  id: string
  noteId: string
}

/**
 * 미팅 + 원본 회의노트를 한 번에 만든다.
 *
 * `withNote: true` 인 이유는 D5 — 원본은 회의노트 하나다.
 * CRM 에서만 만들면 원본 없는 미팅이 생기고, 같은 회의가 두 벌이 된다.
 */
export function buildStartBody(input: StartMeetingInput = {}): Record<string, unknown> {
  const { date, time } = nowKstWall(input.now)
  return {
    title: defaultMeetingTitle(date),
    // KST 벽시계를 +09:00 앵커로 보낸다 — 서버가 UTC 로 정확히 적재한다(datetime SSOT)
    startedAt: `${date}T${time}:00+09:00`,
    companyId: input.companyId || null,
    dealId: input.dealId || null,
    location: null,
    withNote: true,
  }
}

/**
 * 실제로 만든다. 실패하면 **던진다** — 부르는 화면이 사용자에게 읽히는 말로 보여 줘야 한다.
 * 조용히 null 을 돌려주면 버튼을 눌렀는데 아무 일도 안 일어나는 화면이 된다.
 */
export async function startMeeting(input: StartMeetingInput = {}): Promise<StartedMeeting> {
  const res = await fetch('/api/crm/meetings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildStartBody(input)),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(body?.error?.message ?? '미팅을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return { id: body.id as string, noteId: body.noteId as string }
}

/** 만든 뒤 갈 곳 — 작업대 하나뿐이다 */
export function meetingHref(id: string): string {
  return `/crm/meetings/${id}`
}
