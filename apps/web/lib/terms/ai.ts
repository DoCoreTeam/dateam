/**
 * AI 결과를 그릴 때 쓰는 말 (용어집)
 *
 * **왜 여기인가**: 공용 부품은 한글을 한 글자도 안 갖는다. 부품이 문구를 가지면
 * 그 부품을 쓰는 모든 화면이 그 말에 묶이고, 다른 말이 필요한 첫 화면이 부품을 복제한다.
 * 실제로 그렇게 해서 AI 결과를 그리는 화면이 **스물여덟 가지 모양**이 됐다.
 *
 * **고지는 끌 수 없다.** AI 가 만든 것은 AI 가 만들었다고 적는다. 끌 수 있는 고지는
 * 아무도 지킬 의무가 없는 고지다.
 *
 * **금지어**: `생성형 AI` · `LLM` · `모델 출력` · `추론 결과`
 * (우리 쪽 사정을 화면에 옮겨 적은 말이다. 사용자에게는 「AI 가 만들었다」로 충분하다)
 */

/** 부품 한 벌이 쓰는 말. 부품은 이 묶음을 통째로 받는다 */
export const AI_LABELS = {
  generated: 'AI가 만든 결과입니다',
  showEvidence: '근거 보기',
  noEvidence: '근거가 남아 있지 않아요',
  confidence: '확신',
  confidenceUnknown: '확신을 말하지 않았어요',
  candidate: '확인 전',
  confirmed: '확인함',
  corrected: '사람이 고침',
  accept: '반영',
  reject: '그대로 두기',
  askAgain: '다시 물어보기',
  inProgress: '받는 중',
  olderContract: '이전 방식으로 만든 결과',
} as const

/** 사람이 정리해 둔 답이라 AI 를 안 쓴 경우 */
export const NOT_AI = '미리 정리해 둔 답입니다 (AI 미사용)'

/** 확신이 낮을 때 덧붙이는 한 줄 */
export const LOW_CONFIDENCE_HINT = '확신이 낮으니 원문을 함께 확인해 주세요'
