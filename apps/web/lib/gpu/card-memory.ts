// GPU 메모리 표기 SSOT — 총합(memory) + 장수(gpu_count)를 "카드당 × 장수"로 표기.
// gpu_products.memory 는 구성 전체 총합(예 "80GB"), gpu_count 는 카드 장수(예 2).
// 카드당 메모리 사전이 없으므로 총합 ÷ 장수로 역산한다(시드 데이터는 전부 정수 분할).
// 전제: memory 단위는 항상 GB(시드 일원). 다른 단위가 섞이면 폴백(총합 그대로)된다.

/**
 * "40GB × 2" 형태 라벨 생성.
 * - 장수 ≤ 1: 총합 그대로("40GB") — "×1" 미표기.
 * - 장수 > 1 & 정수 분할: "<카드당>GB × <장수>"(예 "40GB × 2").
 * - 파싱 불가 / null / 비정수 분할: 총합(memory) 그대로 폴백.
 */
export function formatCardMemory(
  memory: string | null | undefined,
  gpuCount: number | null | undefined,
): string {
  const raw = (memory ?? '').trim()
  if (!raw) return ''
  const total = parseFloat(raw.replace(/[^0-9.]/g, ''))
  const count = gpuCount ?? 1
  if (!Number.isFinite(total) || count <= 1) return raw

  const perCard = total / count
  // 정수로 나누어떨어질 때만 카드당 × 장수 표기, 아니면 총합 폴백.
  if (!Number.isInteger(perCard)) return raw
  return `${perCard}GB × ${count}`
}

/**
 * 카드당 용량만("40GB"). 장수(×N)가 모델명 등 인접 요소에 이미 표시되어
 * 좁은 칩/아이콘에서 총합 대신 카드당만 보여야 할 때 사용.
 * - 장수 ≤ 1 또는 파싱 불가: 총합(memory) 그대로 폴백.
 * - 비정수 분할: 총합 폴백.
 */
export function perCardMemory(
  memory: string | null | undefined,
  gpuCount: number | null | undefined,
): string {
  const raw = (memory ?? '').trim()
  if (!raw) return ''
  const total = parseFloat(raw.replace(/[^0-9.]/g, ''))
  const count = gpuCount ?? 1
  if (!Number.isFinite(total) || count <= 1) return raw
  const perCard = total / count
  if (!Number.isInteger(perCard)) return raw
  return `${perCard}GB`
}

/**
 * 마우스 오버(title) 툴팁용 — 총 용량을 친절히 보여준다.
 * - 장수 > 1: "총 80GB (40GB × 2)" 형태.
 * - 장수 ≤ 1 / 파싱 불가 / 비정수: 빈 문자열(툴팁 불필요 — 표시값이 이미 총합).
 */
export function memoryTitle(
  memory: string | null | undefined,
  gpuCount: number | null | undefined,
): string {
  const raw = (memory ?? '').trim()
  if (!raw) return ''
  const total = parseFloat(raw.replace(/[^0-9.]/g, ''))
  const count = gpuCount ?? 1
  if (!Number.isFinite(total) || count <= 1) return ''
  const perCard = total / count
  if (!Number.isInteger(perCard)) return ''
  return `총 ${raw} (${perCard}GB × ${count})`
}
