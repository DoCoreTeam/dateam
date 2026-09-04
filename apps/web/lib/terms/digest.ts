/**
 * 정리의 말 — SSOT (용어집 §02)
 *
 * **왜 이 파일이 생겼나** (실측 2026-09-05, 사용자 지적):
 * *"결국 우리가 봐야되는건 정리된 내용일텐데 … 정리가 가장 먼저 보여야 하는거 아냐?"*
 *
 * 조사해 보니 같은 일을 부르는 말이 **다섯 개**였다 —
 *   `AI 분석` 42곳 · `AI로 정리하기` 11곳 · `AI 정제본` 8곳 · `정리하기` 7곳 · `정리` 1곳.
 *
 * 그리고 그중 둘은 **정말로 다른 일이었다.** 「AI 분석」은 `meeting_notes.summary` 에 쓰고,
 * 「정리」 탭은 `meeting_note_digest` 에 썼다. 사용자가 이름만 보고 같은 일이라 믿는 동안
 * 결과는 두 곳에 갈라져 쌓였고, 그중 한쪽(16건)은 **화면에 영원히 안 나왔다.**
 *
 * 말이 갈리는 것이 먼저였고 저장소가 갈린 것이 그 뒤였다. 그래서 말부터 하나로 내린다.
 *
 * **표준은 「정리」다.** ~~AI 분석~~ ~~AI 정제본~~ ~~AI로 정리하기~~ 를 쓰지 않는다:
 *   · 「분석」은 **무엇이 나오는지** 안 밝힌다 — 나오는 것은 안건·사실·결정사항이다
 *   · 「정제본」은 원문이 거친 것이라는 뜻을 담아 사용자가 쓴 글을 낮춘다
 *   · 「AI」를 라벨에 붙이지 않는다 — 사용자가 원하는 것은 결과이지 도구가 아니다
 *     (도구를 밝혀야 하는 자리는 라벨이 아니라 결과 옆의 출처 표시다)
 */

/** 결과물의 이름. 탭·패널·제목이 전부 이 말을 쓴다 */
export const DIGEST_LABEL = '정리'

/** 만드는 행위 — 처음 만들 때 */
export const DIGEST_RUN_LABEL = '정리하기'

/** 다시 만드는 행위 — 이미 있는데 새로 뽑을 때. 「재분석」·「재생성」을 쓰지 않는다 */
export const DIGEST_RERUN_LABEL = '다시 정리'

/**
 * 회의에서 **할 일·일정 후보를 뽑는 것** — 정리와 다른 일이다.
 *
 * 둘이 「AI 분석」이라는 한 이름을 나눠 쓴 것이 이 사고의 출발점이었다.
 * 정리는 **읽을 것**을 만들고, 뽑기는 **다른 화면에 옮길 후보**를 만든다.
 * 결과가 가는 곳이 다르므로 이름도 달라야 한다.
 */
export const EXTRACT_LABEL = '할 일·일정 뽑기'

/** 뽑기 실행 버튼. 이미 「할 일·일정 뽑기」 카드 안이라 짧게 쓴다 */
export const EXTRACT_RUN_LABEL = '뽑기'

/** 재료 — 사람이 쓴 것. 「메모」가 아니라 「작성」인 이유는 탭 라벨과 같아야 하기 때문이다 */
export const MEMO_LABEL = '작성'

/** 재료 — 기계가 받아적은 것 */
export const TRANSCRIPT_LABEL = '녹음·전사'

/**
 * 재료를 함께 부르는 말.
 *
 * 「원문」이 아니라 **「근거」**다 — 정리를 먼저 읽은 사람에게 이 둘은
 * *"그 말이 어디서 나왔나"* 를 확인하는 자리이지 별도의 읽을거리가 아니다.
 */
export const EVIDENCE_LABEL = '근거'

/**
 * 정리가 만들어진 뒤 재료가 바뀌었을 때.
 *
 * **「오래됨」·「만료」를 쓰지 않는다** — 시간이 지나서가 아니라 **읽은 것이 달라져서**다.
 * 시간 문제로 읽히면 사용자는 "그냥 오래된 거네"라고 넘긴다.
 */
export const DIGEST_STALE_LABEL = '내용이 바뀜'

/** 정리에 쓸 재료가 아예 없을 때 — 버튼을 못 누르는 이유를 밝힌다 */
export const DIGEST_NO_MATERIAL = '정리할 내용이 없어요. 작성하거나 녹음해 주세요.'

/** 아직 안 만들었을 때의 제목. 「없음」이 아니라 **아직**이다 — 할 수 있는 일이라는 뜻 */
export const DIGEST_EMPTY_TITLE = '아직 정리하지 않았어요'

/**
 * 사실이 어디서 나왔나 — 정리본의 사실마다 붙는 배지.
 *
 * `lib/meeting/digest-prompt.ts` 의 `FACT_ORIGIN_LABEL` 이 이 값을 쓴다.
 * 두 곳에 적으면 갈라지므로 여기가 정본이다.
 */
export const FACT_ORIGIN: Record<'memo' | 'transcript' | 'both', string> = {
  memo: MEMO_LABEL,
  transcript: '녹음',
  both: '둘 다',
}

/**
 * 무엇으로 정리하는지 — **누르기 전에** 보여 주는 한 줄.
 *
 * 「정리하기」만 있으면 무엇을 읽는지 모른 채 누른다. 그리고 결과가 빈약할 때
 * 왜 그런지도 모른다. 재료를 먼저 말하면 둘 다 해결된다.
 *
 * 재료가 하나도 없으면 `null` — 부를 문장이 없다. 호출부가 버튼을 감춘다.
 */
export function digestMaterialLine(memoChars: number, segmentCount: number): string | null {
  const parts: string[] = []
  if (memoChars > 0) parts.push(`${MEMO_LABEL} ${memoChars.toLocaleString()}자`)
  if (segmentCount > 0) parts.push(`녹음 ${segmentCount.toLocaleString()}줄`)
  if (parts.length === 0) return null
  return parts.join(' · ')
}

/**
 * 정리 이후 재료가 얼마나 달라졌나 — 사용자에게 보여 줄 한 줄.
 *
 * **숫자를 함께 밝힌다.** "바뀌었어요"만 있으면 다시 돌릴지 판단할 근거가 없다 —
 * 218자가 640자가 된 것과 218자가 220자가 된 것은 다른 결정이다.
 */
export function digestStaleLine(
  then: { memoChars: number; segmentCount: number },
  now: { memoChars: number; segmentCount: number },
): string | null {
  const parts: string[] = []
  if (now.memoChars !== then.memoChars) {
    parts.push(`${MEMO_LABEL} ${then.memoChars.toLocaleString()}자 → ${now.memoChars.toLocaleString()}자`)
  }
  if (now.segmentCount !== then.segmentCount) {
    parts.push(`녹음 ${then.segmentCount.toLocaleString()}줄 → ${now.segmentCount.toLocaleString()}줄`)
  }
  if (parts.length === 0) return null
  return `${DIGEST_LABEL} 이후 ${parts.join(' · ')}`
}
