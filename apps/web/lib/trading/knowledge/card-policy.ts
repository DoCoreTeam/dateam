/**
 * 지식 카드 정책 — **근거 없으면 카드가 아니다**
 *
 * ## 왜 근거를 강제하나
 *
 * AI 가 쓴 글은 근거가 없어도 그럴듯하다. 그리고 트레이딩 화면에 뜬 그럴듯한 글은
 * 사람이 돈을 넣는 근거가 된다. 「코스피200 선물은 개장 직후 변동이 크다」는 문장이
 * 관측에서 나왔는지 모델이 지어냈는지 화면에서는 구별이 안 된다.
 *
 * 그래서 출처가 0건이면 **카드를 만들지 않는다.** DB 검사 제약이 한 번 더 막지만,
 * 여기서 먼저 걸러야 「왜 안 만들어졌나」에 답할 수 있다.
 *
 * ## 왜 덮어쓰지 않고 판을 쌓나
 *
 * 카드를 고쳐 덮으면 「그때 무엇을 알고 있었나」가 사라진다. 백테스트가 과거 시점을
 * 볼 때 읽어야 할 것은 지금 판이 아니라 **그때 판**이다.
 */

export interface CardSource {
  kind: 'observation' | 'source_analysis' | 'pattern_report'
  ref: string
  note: string
}

export interface CardDraft {
  topic: string
  title: string
  body: string
  sources: CardSource[]
}

export type CardRejection = { reason: string; userMessage: string }

/** 주제 이름 상한. 넘으면 자른다 — 던지면 카드 하나 때문에 그 실행이 통째로 죽는다 */
export const MAX_TOPIC_LENGTH = 120
export const MAX_TITLE_LENGTH = 200
export const MAX_BODY_LENGTH = 4000

/**
 * 이 초안을 카드로 세워도 되나.
 *
 * 길이는 **던지지 않고 자른다**(`normalizeDraft`). 근거 없음만 거절이다 —
 * 길어서 못 쓰는 것과 근거가 없어서 못 쓰는 것은 다른 일이고, 앞의 것은 고칠 수 있다.
 */
export function validateDraft(draft: CardDraft): CardRejection | null {
  if (draft.topic.trim() === '') {
    return { reason: 'empty_topic', userMessage: '주제가 비어 있어 카드를 만들지 않았습니다' }
  }
  if (draft.body.trim() === '') {
    return { reason: 'empty_body', userMessage: '내용이 비어 있어 카드를 만들지 않았습니다' }
  }
  if (draft.sources.length === 0) {
    return {
      reason: 'no_sources',
      userMessage: '근거가 없어 카드를 만들지 않았습니다. 지어낸 글은 화면에 올리지 않습니다',
    }
  }
  const bad = draft.sources.find((s) => s.ref.trim() === '')
  if (bad) {
    return { reason: `empty_source_ref:${bad.kind}`, userMessage: '근거에 가리키는 것이 없습니다' }
  }
  return null
}

/** 잘랐다는 표시. 길이를 셈에 쓰므로 상수로 둔다 — 「12자쯤이겠지」로 빼면 결과가 상한과 안 맞는다 */
export const TRUNCATION_MARK = '… (잘림)'

/** 길이를 맞춘다. 자른 사실은 몸글 끝에 남는다 — 조용히 잘리면 문장이 중간에 끊긴다 */
export function normalizeDraft(draft: CardDraft): CardDraft {
  const cut = (s: string, n: number) =>
    (s.length <= n ? s : s.slice(0, Math.max(0, n - TRUNCATION_MARK.length)) + TRUNCATION_MARK)
  return {
    topic: draft.topic.trim().slice(0, MAX_TOPIC_LENGTH),
    title: cut(draft.title.trim(), MAX_TITLE_LENGTH),
    body: cut(draft.body.trim(), MAX_BODY_LENGTH),
    sources: draft.sources.map((s) => ({ ...s, ref: s.ref.trim(), note: s.note.trim() })),
  }
}

/** 다음 판 번호. 덮어쓰지 않고 쌓는다 */
export function nextRevision(current: number | null): number {
  return (current ?? 0) + 1
}

/**
 * AI 응답을 초안으로 읽는다.
 *
 * 모르는 꼴이면 **지어내지 않고 거절한다.** 빈 카드를 만들면 화면에 근거 없는 글이 뜬다.
 */
export function parseDraft(topic: string, raw: unknown): CardDraft | CardRejection {
  if (typeof raw !== 'object' || raw === null) {
    return { reason: 'not_an_object', userMessage: 'AI 응답을 읽지 못했습니다' }
  }
  const o = raw as Record<string, unknown>
  const sources = Array.isArray(o.sources) ? o.sources : []
  const draft: CardDraft = {
    topic,
    title: typeof o.title === 'string' ? o.title : '',
    body: typeof o.body === 'string' ? o.body : '',
    sources: sources.flatMap((s) => {
      if (typeof s !== 'object' || s === null) return []
      const r = s as Record<string, unknown>
      const kind = r.kind
      if (kind !== 'observation' && kind !== 'source_analysis' && kind !== 'pattern_report') return []
      return [{
        kind,
        ref: typeof r.ref === 'string' ? r.ref : '',
        note: typeof r.note === 'string' ? r.note : '',
      }]
    }),
  }
  const rejection = validateDraft(normalizeDraft(draft))
  return rejection ?? normalizeDraft(draft)
}

export function isRejection(v: CardDraft | CardRejection): v is CardRejection {
  return 'reason' in v
}

/**
 * 프롬프트.
 *
 * **지어내지 말라고 적는 것만으로는 안 된다** — 그래서 근거 배열을 요구하고,
 * 빈 배열이면 위에서 거절하고, DB 검사 제약이 한 번 더 막는다. 말·코드·표 세 겹이다.
 */
export function buildCardPrompt(topic: string, facts: readonly string[]): string {
  return [
    '너는 선물 트레이딩 기록을 정리하는 사람이다.',
    '아래 「확인된 사실」만 써서 지식 카드 하나를 만든다.',
    '',
    '규칙',
    '- 사실에 없는 것을 쓰지 않는다. 쓸 것이 없으면 sources 를 빈 배열로 둔다',
    '- 각 문장의 근거를 sources 에 ref 로 남긴다',
    '- 예측하지 않는다. 「오를 것이다」 같은 말을 쓰지 않는다',
    '- 숫자를 지어내지 않는다. 사실에 있는 숫자만 옮긴다',
    '',
    `주제: ${topic}`,
    '',
    '확인된 사실',
    ...facts.map((f, i) => `${i + 1}. ${f}`),
    '',
    'JSON 으로만 답한다:',
    '{"title": "...", "body": "...", "sources": [{"kind": "observation|source_analysis|pattern_report", "ref": "...", "note": "..."}]}',
  ].join('\n')
}
