/**
 * 정리 자리에 무엇을 그리나 — **한 곳에서 정한다.**
 *
 * 사용자 지적(2026-09-23): *"녹음 밑에 정리하기 부분에 내용이 없으면 노출 시키지 말고
 * 녹음 하고 나서 실제 정리 되면 나오게 하자 헷갈려 아래 입력 하는 부분을 쓰려고 할때
 * 위에가 붕떠있어서"*.
 *
 * 예전엔 정리본이 없으면 제목·설명·아이콘이 든 **큰 빈 상자**를 그렸다. 그 상자가
 * 카드 본문 자리를 250px 쯤 차지해서, 정작 사람이 글을 쓰는 원문 편집기가 그만큼
 * 아래로 밀렸다. 결과가 없다는 말을 하려고 결과 자리를 통째로 쓴 셈이다.
 *
 * 그래서 셋으로 나눈다.
 *   result — 정리본이 있다. 그대로 그린다
 *   run    — 정리본은 없지만 **읽을 재료가 있고** 실행할 수 있다. 실행 단추 한 줄만
 *   none   — 그릴 것이 없다. **아무것도 안 그린다**
 *
 * 재료가 없으면 `run` 도 아니다 — 읽을 것이 없는데 누르면 빈 정리본이 나온다.
 * 판정을 여기 두는 이유는 `workbench-tab.ts` 와 같다(E-6): 화면 안에 조건식으로 두면
 * 실브라우저 말고는 검증할 수단이 없다.
 */

export type DigestSlot = 'result' | 'run' | 'none'

export interface DigestSlotInput {
  /** 정리본이 한 판이라도 있나 */
  hasDigest: boolean
  /** 사람이 쓴 글자 수 */
  memoChars: number
  /** 받아적은 줄 수 */
  segmentCount: number
  /** 이 사람이 정리를 돌릴 수 있나 */
  canEdit: boolean
}

/** 읽을 재료가 있나 — 둘 중 하나라도 있으면 정리를 돌릴 값어치가 있다 */
export function hasDigestMaterial(memoChars: number, segmentCount: number): boolean {
  return memoChars > 0 || segmentCount > 0
}

export function digestSlot({ hasDigest, memoChars, segmentCount, canEdit }: DigestSlotInput): DigestSlot {
  if (hasDigest) return 'result'
  if (canEdit && hasDigestMaterial(memoChars, segmentCount)) return 'run'
  return 'none'
}
