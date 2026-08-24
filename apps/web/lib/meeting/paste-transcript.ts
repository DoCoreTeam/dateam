/**
 * 붙여넣은 회의 내용 → 전사 줄 (SSOT).
 *
 * **왜 뽑아냈나.** 이 파싱은 원래 `lib/crm/stt/adapter.ts` 의 `pastedTranscriptAdapter`
 * 안에만 있었다. 이제 회의노트 쪽에서도 붙여넣기를 받는다(원본은 회의노트 하나) —
 * 거기서 정규식을 다시 쓰면 **같은 글이 두 화면에서 다르게 갈린다.**
 * 규칙을 한 곳에 두고 둘 다 여기를 부른다.
 *
 * 규칙은 하나다: 줄 하나가 구간 하나. `이름: 말` 이면 화자를 갈라 읽는다.
 */

/** `이름: 말` 을 가르는 규칙. 이름이 20자를 넘으면 그건 이름이 아니라 문장이다 */
const SPEAKER_LINE = /^([^:：]{1,20})[:：]\s*(.+)$/

/** 화자를 못 읽었을 때의 이름 — 지어내지 않고 "모른다"를 표시한다 */
export const UNKNOWN_SPEAKER = '화자'

export interface PastedLine {
  idx: number
  speaker: string
  /**
   * 붙여넣은 글에는 시각이 없다. 순서만 지키는 자리표시다.
   * 0 으로 둘 수 없는 이유: DB 가 `end_ms > start_ms` 를 요구한다(마이그 217 CHECK).
   */
  startMs: number
  endMs: number
  text: string
}

/**
 * @param baseMs 이 회의에서 이미 쓰인 마지막 시각. 붙여넣기를 **그 뒤에** 놓는다.
 *   0 이면 처음부터다. 안 주면 녹음이 있는 회의에서 붙여넣은 줄이 맨 앞으로 끼어든다
 *   (실측 v0.7.593).
 */
export function parseSpeakerLines(text: string, baseMs = 0): PastedLine[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const m = line.match(SPEAKER_LINE)
      return {
        idx: i,
        speaker: m ? m[1].trim() : UNKNOWN_SPEAKER,
        startMs: baseMs + i * 1000,
        endMs: baseMs + i * 1000 + 999,
        text: m ? m[2].trim() : line,
      }
    })
}
