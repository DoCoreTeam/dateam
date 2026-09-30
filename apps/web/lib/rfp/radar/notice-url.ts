/**
 * 공고 원문 주소 — **받아 둔 값을 제대로 읽는다**
 *
 * ## 무엇이 잘못돼 있었나
 *
 * 케이스 상세가 `raw.url` 을 읽었다. 그런데 나라장터 응답이 담기는 칸 이름은 `bidNtceUrl` 이다.
 * 그래서 g2b 공고의 「공고 원문」은 **늘 비어 있었다** — 오류도 안 났고 값은 처음부터 거기 있었다.
 *
 * 실측 2026-10-01: `raw->>url` 이 있는 것 10건, `raw->>bidNtceUrl` 이 있는 것 **537건**, 전체 567건.
 * 즉 열에 아홉이 주소를 갖고 있는데 화면은 하나도 못 보여 줬다.
 *
 * `status:'adopted'` 와 같은 부류다 — 값은 있는데 이름이 틀려서 조용히 없는 기능이 된다.
 *
 * ## 왜 두 이름을 다 보나
 *
 * 공고는 두 길로 들어온다. 나라장터는 `bidNtceUrl` 로 주고, 기관 사이트를 훑은 것은 `url` 로 준다.
 * 한쪽만 읽으면 다른 쪽이 죽는다 — 고치면서 멀쩡하던 것을 깨뜨리지 않으려고 둘 다 본다.
 *
 * ## 왜 규약을 검사하나
 *
 * 이 값은 **밖에서 온 것**이고 화면에서 링크가 된다. `javascript:` 로 시작하는 값이 그대로
 * href 에 들어가면 그 자리가 실행 통로가 된다. 그래서 http/https 만 통과시킨다.
 */

/** 공고가 주소를 담아 오는 칸 이름들. 앞의 것이 이긴다 */
export const URL_KEYS = ['bidNtceUrl', 'url'] as const

/** 링크로 내보내도 되는 규약. 늘리려면 왜 안전한지를 함께 적는다 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * 원문 주소를 꺼낸다. 없으면 null — 지어내지 않는다.
 *
 * 없는 것을 그럴듯한 주소로 채우면 사용자는 눌러서 엉뚱한 데로 간다.
 */
export function noticeUrlOf(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>

  for (const key of URL_KEYS) {
    const v = row[key]
    if (typeof v !== 'string') continue
    const safe = safeUrl(v)
    if (safe) return safe
  }
  return null
}

/** 규약을 검사한다. 통과 못 하면 null — 링크를 안 만든다 */
export function safeUrl(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const u = new URL(text)
    return SAFE_PROTOCOLS.has(u.protocol) ? u.toString() : null
  } catch {
    // 주소로 안 읽히면 링크도 아니다
    return null
  }
}

/** 바깥으로 나가는 링크에 붙일 것. 한자리에 두어 자리마다 빠지지 않게 한다 */
export const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  /*
    noopener 가 없으면 열린 쪽이 `window.opener` 로 우리 탭의 주소를 바꿀 수 있다.
    noreferrer 는 우리가 어디서 보냈는지를 안 알린다.
  */
  rel: 'noopener noreferrer',
} as const
