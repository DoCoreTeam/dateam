// apps/web/lib/contact/format.ts — 연락처 표시 SSOT
//
// **왜 여기 한 곳인가**: 저장용 정규화(`lib/crm/domain/normalize.ts`의 `normalizePhone`)는
// 구분자를 지워 `01040593436` 을 만든다. 그건 저장에는 맞지만 **읽으라고 만든 값이 아니다.**
// 그런데 표시용 변환이 어디에도 없어서, 모든 화면이 저장값을 그대로 뿌리고 있었다
// (사용자 지적: "사소한건데 연락처 표기를 왜 이렇게 했는지?").
//
// 화면마다 하이픈을 넣기 시작하면 화면마다 규칙이 갈린다 — 그래서 여기서만 정한다.
// 표시 변환은 SSOT 라는 정책(§실제 렌더 경로 4)의 적용이다.

/** 숫자와 선행 `+` 만 남긴다. `tel:` 이 이해하는 형태이자, 형식 판정의 입력이다. */
function digitsOf(raw: string): string {
  const plus = raw.trim().startsWith('+')
  const digits = raw.replace(/\D/g, '')
  return plus ? `+${digits}` : digits
}

/** 세 토막으로 자른다 */
function join(...parts: string[]): string {
  return parts.filter(Boolean).join('-')
}

/**
 * 국내 번호(숫자만)를 사람이 읽는 형태로. 아는 형태가 아니면 `null` —
 * **모르는 번호를 지어내서 자르지 않는다.** 잘못 자른 번호는 안 자른 번호보다 나쁘다.
 */
function formatDomestic(d: string): string | null {
  // 서울 02 — 국번이 3자리(구번호)와 4자리(신번호) 둘 다 살아 있다
  if (d.startsWith('02')) {
    const rest = d.slice(2)
    if (rest.length === 7) return join('02', rest.slice(0, 3), rest.slice(3))
    if (rest.length === 8) return join('02', rest.slice(0, 4), rest.slice(4))
    return null
  }

  // 전국대표번호 15xx·16xx·18xx — 지역번호가 없어 8자리다
  if (/^1[568]\d{6}$/.test(d)) return join(d.slice(0, 4), d.slice(4))

  // 평생번호 050x — 국번이 4자리라 010 규칙으로 자르면 어긋난다
  if (/^050\d{9}$/.test(d)) return join(d.slice(0, 4), d.slice(4, 8), d.slice(8))

  // 이동전화·지역번호(3자리) — 국번 3자리(구) / 4자리(현행)
  if (/^0\d{9}$/.test(d)) return join(d.slice(0, 3), d.slice(3, 6), d.slice(6))
  if (/^0\d{10}$/.test(d)) return join(d.slice(0, 3), d.slice(3, 7), d.slice(7))

  return null
}

/**
 * 화면에 그릴 전화번호. 아는 형태면 하이픈을 넣고, 모르면 **원문 그대로** 돌려준다.
 *
 * `+82` 는 국내 표기로 바꿔 보여 준다 — 같은 번호이고 한국 사용자는 그렇게 읽는다.
 * 원래의 국제 표기는 `telHref` 가 그대로 들고 가므로 거는 데는 영향이 없다.
 */
export function formatPhone(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''

  const d = digitsOf(trimmed)

  if (d.startsWith('+82')) {
    const national = d.slice(3)
    const domestic = national.startsWith('0') ? national : `0${national}`
    return formatDomestic(domestic) ?? trimmed
  }
  // 한국 외 번호는 나라마다 규칙이 달라 손대지 않는다
  if (d.startsWith('+')) return trimmed

  return formatDomestic(d) ?? trimmed
}

/**
 * `tel:` 주소. 모바일에서 누르면 바로 전화가 걸린다.
 * 걸 수 없는 값이면 `null` — 눌러도 아무 일 없는 링크를 만들지 않는다.
 */
export function telHref(raw: string | null | undefined): string | null {
  const d = digitsOf((raw ?? '').trim())
  const bare = d.startsWith('+') ? d.slice(1) : d
  // 국내 최단(대표번호 8자리)보다 짧으면 번호가 아니다
  if (bare.length < 8) return null
  return `tel:${d}`
}

/**
 * `mailto:` 주소. 주소 꼴이 아니면 `null` —
 * 저장 경로(`normalizeEmail`)와 같은 최소 검증만 한다. 과한 정규식은 정상 주소를 막는다.
 */
export function mailtoHref(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return `mailto:${value}`
}
