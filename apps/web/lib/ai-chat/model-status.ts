// 모델 상태·능력을 사람 말로 옮기는 표 (SSOT)
//
// 같은 말을 두 화면이 각자 적고 있었다 — 모델 선택 모달과 모델 화면.
// 한쪽만 고치면 "현재 한도 도달"과 "한도 초과"가 같은 상태에 붙는다.
// 색도 여기서 정한다. 상태색은 뜻이라서 화면이 고를 일이 아니다(§0-2).
//
// **아이콘은 여기 없다** — 표면마다 크기가 달라 화면이 정한다(lib/nav/menu.ts 와 같은 규칙).

export type ModelAvailability = 'available' | 'limited' | 'unavailable' | 'unknown'

export const MODEL_STATUS_LABEL: Record<ModelAvailability, string> = {
  available: '사용 가능',
  limited: '현재 한도 도달',
  unavailable: '사용 불가',
  unknown: '확인 필요',
}

/** 상태 = 뜻이므로 색이 따라온다. 한도는 경고(시간이 지나면 풀린다), 사용 불가는 위험 */
export const MODEL_STATUS_COLOR: Record<ModelAvailability, string> = {
  available: 'var(--success)',
  limited: 'var(--warning)',
  unavailable: 'var(--danger)',
  unknown: 'var(--text-faint)',
}

/** 카탈로그의 capabilities 키 → 화면에 적는 말 */
export const MODEL_CAP_LABEL: Record<string, string> = {
  vision: '이미지 읽기',
  longContext: '긴 문서',
  reasoning: '추론',
}
