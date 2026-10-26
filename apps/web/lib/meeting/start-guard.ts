/**
 * 녹음 중에는 새 회의를 만들지 않는다 (SSOT)
 *
 * 실측 2026-10-26: 지역 녹음을 켠 뒤 시작 단추가 다시 열려 있었고, 다시 누르자
 * 서버 회의가 하나 더 생기고 화면이 그리로 옮겨 갔다. 녹음기는 그대로 앞 회의로 녹음해
 * 사용자가 쓴 회의에는 구간이 0개였다.
 *
 * `useBusyWithOther` 와 같은 판정이지만 회의 id 와 무관하다. 시작 단추는 아직 회의가 없으므로
 * 이 탭이든 다른 탭이든 **녹음이 하나라도 돌면** 막는다.
 * 화면 판정을 컴포넌트에 두면 실브라우저 말고 검증할 수단이 없어 순수 함수로 둔다.
 */

interface RecordingRef {
  noteId: string
  title: string
  href: string
}

export interface StartGuardInput {
  target: RecordingRef | null
  state: string
  remote: RecordingRef | null
}

export interface StartBlock extends RecordingRef {
  /** 다른 탭의 녹음인가 */
  elsewhere: boolean
}

const BUSY_STATES = new Set(['recording', 'paused', 'stopping'])

export function activeRecordingBlock(rec: StartGuardInput): StartBlock | null {
  if (rec.target && BUSY_STATES.has(rec.state)) {
    const { noteId, title, href } = rec.target
    return { noteId, title, href, elsewhere: false }
  }
  if (rec.remote) {
    const { noteId, title, href } = rec.remote
    return { noteId, title, href, elsewhere: true }
  }
  return null
}

/** 막히면 `start` 를 부르지 않는다. 두 시작 단추가 같은 길을 지난다 */
export async function startUnlessRecording<T>(
  rec: StartGuardInput,
  start: () => Promise<T>,
): Promise<{ blocked: StartBlock; result: null } | { blocked: null; result: T }> {
  const blocked = activeRecordingBlock(rec)
  if (blocked) return { blocked, result: null }
  return { blocked: null, result: await start() }
}

/** 막혔을 때 화면이 하는 말, 녹음 패널의 안내와 같은 말투 */
export function startBlockedMessage(block: StartBlock): string {
  return block.elsewhere
    ? `다른 탭에서 "${block.title}"를 녹음하는 중이라 새 회의를 시작할 수 없어요. 그 탭에서 끝낸 뒤 눌러 주세요.`
    : `"${block.title}"를 녹음하는 중이라 새 회의를 시작할 수 없어요. 그 녹음을 끝낸 뒤 눌러 주세요.`
}
