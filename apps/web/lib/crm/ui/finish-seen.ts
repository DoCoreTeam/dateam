/**
 * 「미팅 끝내기」 결과 상자를 **확인했는가** — 기기마다 잡 id 한 줄로 기억한다.
 *
 * 사용자 지적(2026-10-21): 「미팅을 정리했어요는 나왔다가 확인했으면 없어져야지」.
 * 결과는 서버 잡에 남아 있어(나갔다 와도 보이게 한 설계) 들어올 때마다 다시 떴다.
 *
 * 잡 id 로 기억하는 까닭: 「다시 정리」를 누르면 새 잡이 생기고 그 결과는 다시 보여야 한다.
 * 저장소가 막힌 환경(사생활 창 등)에서는 기억만 못 할 뿐 화면은 그대로 돈다.
 */

const KEY_PREFIX = 'crm.meeting.finish.seen.'

export function finishSeenKey(jobId: string): string {
  return `${KEY_PREFIX}${jobId}`
}

export function isFinishSeen(jobId: string | null, store: Pick<Storage, 'getItem'> | null): boolean {
  if (!jobId || !store) return false
  try {
    return store.getItem(finishSeenKey(jobId)) === '1'
  } catch {
    return false
  }
}

export function markFinishSeen(jobId: string | null, store: Pick<Storage, 'setItem'> | null): void {
  if (!jobId || !store) return
  try {
    store.setItem(finishSeenKey(jobId), '1')
  } catch {
    /* 기억만 못 한다 — 이번 화면에서는 닫힌다 */
  }
}

/** 브라우저 저장소. 서버 렌더이거나 접근이 막히면 null */
export function browserStore(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}
