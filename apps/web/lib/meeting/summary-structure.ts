/**
 * 평문 회의록을 **구조로 되돌린다** — SSOT.
 *
 * ## 왜 생겼나 (실측 2026-09-05, 운영 DB 직접 조회)
 *
 * 사용자 지적: *"정리된 내용 봐봐 그냥 일렬로 다 정리되서 나온거 보이지?
 * 맥락에 맞춰서 줄바꿈이 된것도 없고?"*
 *
 * 조사해 보니 **AI 는 잘못이 없었다.** 프롬프트(`summary-prompt.ts`)가
 * *"`[안건 이름]` 줄과 `- ` 사실 줄을 줄바꿈으로 잇는다"* 를 요구했고, 저장된 값이
 * 정확히 그 형식이었다(이 회의 기준 줄바꿈 **19개**). 그런데 코드가 그 평문을
 * 파싱하지 않고 `facts[0].text` 하나에 통째로 넣었다:
 *
 * ```ts
 * agenda: [{ title: '회의 내용', facts: [{ text: summary.trim() }] }]   // ← 통짜
 * decisions: decisions.split('\n').map(...)                              // ← 이쪽만 나눔
 * ```
 *
 * **같은 응답인데 결정사항만 줄로 나눴다.** 코드는 이미 줄 나누는 법을 알고 있었고,
 * 한쪽에만 쓰지 않았을 뿐이다. 실측 결과 정리본 15건 중 **11건**이 그렇게 저장돼 있다.
 *
 * ## 왜 읽기 시점인가 (DB 를 안 건드리는 이유)
 *
 * 이미 저장된 11건을 고치려면 백필(운영 데이터 변경)이 필요하고 그건 승인이 필요하다.
 * 그런데 이 파서는 **읽을 때 돈다** — `agenda_json` 은 한 글자도 안 바뀌고, 화면만
 * 구조로 그린다. 되돌리기는 이 함수를 안 부르면 끝이라 위험이 0이다
 * (M-12 「형태를 바꾼다」). 그리고 백필을 하더라도 이 파서는 **계속 옳다** —
 * 앞으로 어떤 경로가 평문을 넘기더라도 화면은 구조를 본다.
 *
 * ## 계약: 무손실이 최우선이다
 *
 * 이 파서가 틀리는 방향은 둘인데 무게가 다르다.
 *   · **덜 나누면** — 지금 그대로다. 읽기 불편하지만 사실은 다 있다.
 *   · **잘못 나누면** — 사실이 사라진다. 그건 훨씬 나쁘다.
 * 그래서 **애매하면 안 나눈다.** 형식을 못 알아보는 입력은 통짜 그대로 한 사실로 둔다.
 * `summary-structure.test.ts` 가 「원문의 알맹이가 전부 결과에 있는가」를 단정으로 잡는다.
 *
 * 순수 함수로 두는 이유(완료 조건 E-6): 컴포넌트 안의 식으로 두면 실브라우저 말고는
 * 검증할 수단이 없다. 이 판정이 틀리면 사용자가 읽는 회의록이 통째로 달라진다.
 */

/** 안건 하나 — 제목과 그 아래 사실 줄들. `DigestAgendaItem` 으로 옮기는 것은 호출부가 한다 */
export interface SummaryOutlineItem {
  title: string
  facts: string[]
}

/**
 * 안건 표시가 없는 사실들을 담을 이름.
 *
 * 예전 코드가 통짜를 넣으면서 쓰던 제목과 **같은 말**을 쓴다 — 형식을 못 알아본
 * 입력에서는 결과가 예전과 한 글자도 다르지 않아야 한다(무회귀).
 */
export const UNTITLED_AGENDA = '회의 내용'

/** `[안건 이름]` 한 줄인가. 대괄호 안이 비어 있으면 안건이 아니다 */
const AGENDA_HEAD = /^\[\s*(.+?)\s*\]$/

/** `- ` 또는 `• ` 로 시작하는 사실 줄인가 */
const BULLET = /^[-•]\s*/

/**
 * 평문 회의록을 안건 목록으로.
 *
 * 형식을 못 알아보면 **자르지 않고** 통짜 한 사실로 둔다 — 사실을 잃는 것보다
 * 읽기 불편한 편이 낫다.
 */
export function parseSummaryOutline(summary: string | null | undefined): SummaryOutlineItem[] {
  const text = (summary ?? '').trim()
  if (!text) return []

  const items: SummaryOutlineItem[] = []
  /** 지금 사실을 담고 있는 안건. 안건 표시 없이 사실이 먼저 나오면 여기가 만들어진다 */
  let current: SummaryOutlineItem | null = null

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const head = AGENDA_HEAD.exec(line)
    if (head) {
      current = { title: head[1], facts: [] }
      items.push(current)
      continue
    }

    if (!current) {
      current = { title: UNTITLED_AGENDA, facts: [] }
      items.push(current)
    }

    if (BULLET.test(line)) {
      const fact = line.replace(BULLET, '').trim()
      // 글머리표만 있고 내용이 없는 줄은 버린다 — 화면에 빈 점만 찍힌다
      if (fact) current.facts.push(fact)
      continue
    }

    /*
      글머리표가 없는 줄 — 앞 사실이 이어지는 것으로 본다.
      새 사실로 쪼개면 한 문장이 두 줄로 갈라져 **사실 개수가 부풀고** 문장이 중간에서 끊긴다.
      앞 사실이 없으면(안건 바로 아래 첫 줄) 그 줄 자체가 첫 사실이다.
    */
    if (current.facts.length > 0) {
      current.facts[current.facts.length - 1] += ` ${line}`
    } else {
      current.facts.push(line)
    }
  }

  // 사실이 없는 안건은 버린다 — 제목만 남은 빈 칸을 만들지 않는다(`parseDigestResult` 와 같은 규칙)
  return items.filter((a) => a.facts.length > 0)
}

/**
 * 결정사항 평문을 줄로.
 *
 * **왜 여기로 올렸나**: 똑같은 세 줄이 `digest-run.ts` 와 `legacy-digest.ts` 에
 * 복붙돼 있었다. 한쪽만 고치면 나머지가 남고, 그 상태는 화면에서 구분되지 않는다.
 */
export function parseDecisionLines(decisions: string | null | undefined): string[] {
  return (decisions ?? '')
    .split('\n')
    .map((l) => l.replace(BULLET, '').trim())
    .filter(Boolean)
}
