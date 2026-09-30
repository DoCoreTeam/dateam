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
import { ServerUnreachableError } from '../../offline/reachable.ts'

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
  /**
   * 캘린더에서 **다른 날짜를 눌러** 시작할 때 그 날(YYYY-MM-DD).
   *
   * 없으면 지금이다(기존 동작 그대로). 지난 날짜의 회의를 뒤늦게 적을 때
   * 이걸 안 주면 **그 회의가 오늘 일어난 것으로 기록된다.**
   * 시각은 모르므로 그 날 09:00 로 둔다 — 작업대에서 언제든 고친다.
   */
  dateKey?: string | null
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
  const now = nowKstWall(input.now)
  // 다른 날짜를 눌러 시작했으면 그 날이다. 시각은 모르니 업무 시작 시각으로 둔다
  const isOtherDay = Boolean(input.dateKey) && input.dateKey !== now.date
  const date = input.dateKey || now.date
  const time = isOtherDay ? '09:00' : now.time
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
 *
 * **실패가 두 종류라 말도 둘이다** (실측 2026-09-30):
 *   ① 요청이 아예 못 나갔다 — 브라우저가 주는 원문은 「Failed to fetch」다. 그 말은 영어인 데다
 *      무엇이 잘못됐는지도 무엇을 하면 되는지도 말하지 않는다. 사용자가 이 말을 봤다.
 *   ② 서버가 답했는데 거절했다 — 그 사유는 서버가 더 잘 아니 그대로 전한다.
 * 둘을 한 말로 뭉개면, 권한이 없어서 막힌 사람에게 「연결을 확인하세요」라고 말하게 된다.
 */
export async function startMeeting(input: StartMeetingInput = {}): Promise<StartedMeeting> {
  let res: Response
  try {
    res = await fetch('/api/crm/meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildStartBody(input)),
    })
  } catch {
    // 답이 하나도 안 왔다. 여기서 브라우저 원문을 그대로 올리면 화면에 「Failed to fetch」가 뜬다.
    // 형을 따로 두는 이유는 부르는 쪽이 **기기에 쌓아 두는 길**로 갈라 가기 때문이다
    throw new ServerUnreachableError()
  }

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
