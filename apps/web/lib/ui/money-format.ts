/**
 * 금액 입력의 «보이는 값 ↔ 저장되는 값» 변환 (SSOT)
 *
 * 부품(`components/ui/MoneyField`)과 분리한 이유: 순수 함수라 서버·테스트에서도 쓰고,
 * JSX 파일은 단위 테스트가 직접 import 하지 못한다.
 */

/** 숫자(와 필요하면 소수점)만 남긴다 */
export function digitsOnly(raw: string, allowDecimal = false): string {
  const cleaned = allowDecimal ? raw.replace(/[^\d.]/g, '') : raw.replace(/[^\d]/g, '')
  if (!allowDecimal) return cleaned
  // 소수점은 하나만 — 「1.2.3」 같은 값이 저장되면 계산이 통째로 깨진다
  const [head, ...rest] = cleaned.split('.')
  return rest.length > 0 ? `${head}.${rest.join('')}` : head
}

/** 사람이 읽는 모양. 정수부에만 쉼표를 넣는다 */
export function groupDigits(digits: string): string {
  if (digits === '') return ''
  const [int, frac] = digits.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac === undefined ? grouped : `${grouped}.${frac}`
}
