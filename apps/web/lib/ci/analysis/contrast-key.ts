// lib/ci/analysis/contrast-key.ts — 대조쌍 지문 (순수 계산)
//
// ## 무엇을 푸는가
//
// 발견은 «떡상 1건 vs 평범 3건» 한 묶음을 AI 에게 보여 주고 «이 하나만 다른 점»을 묻는다.
// 그 묶음의 입력은 수집이 끝나면 변하지 않고, 호출은 temperature 0 이다.
// 즉 **같은 묶음에는 같은 답이 온다.**
//
// 그런데 저장하는 자리가 없어서 매번 다시 물었다.
// 실측 2026-09-20: 서로 다른 질문이 최대 624개인데 사흘 동안 49,064번 물었다(78.6배).
//
// 지문은 «이 묶음을 전에 물었는가»를 한 값으로 답하게 한다.
//
// ## 무엇을 지문에 넣고 무엇을 빼는가
//
// **넣는 것: 누가 누구와 비교됐는가 + 무슨 질문을 했는가.**
//   묶음에 속한 콘텐츠의 신원과 프롬프트 판 번호다. 이 둘이 같으면 답이 같다.
//
// **빼는 것: 배수(outlier_index).**
//   배수는 채널 중앙값 대비라 **형제가 하나 들어올 때마다 흔들린다.** 지문에 넣으면
//   내용이 한 글자도 안 바뀌었는데 지문이 날마다 달라져 저장이 아무 일도 못 한다.
//   대신 배수가 «떡상 자격»을 넘나들면 묶음 구성 자체가 달라지므로(그 콘텐츠가
//   승자 목록에서 빠지거나 들어온다) 지문은 그때 제대로 달라진다.
//   즉 **자격이 바뀔 때만 다시 묻는다.**
//
// ## 왜 프롬프트 판 번호가 들어가는가
//
// 질문을 바꾸면 답이 달라진다. 판 번호가 없으면 프롬프트를 고친 날에도 옛 답이
// 그대로 나오고, 고친 사람은 자기 수정이 왜 화면에 안 보이는지 알 수 없다.

/**
 * 발견 프롬프트의 판 번호.
 *
 * **프롬프트 글자를 고치면 반드시 올린다.** 안 올리면 저장된 옛 답이 계속 나온다.
 * 올리면 그날 하루는 전부 다시 묻게 되므로, 사소한 오타 수정으로는 올리지 않는다.
 *
 * 2 (2026-09-20): 설명 원문을 400자에서 120자로 줄였다. 넷이 들어가므로 프롬프트에서
 * 최대 1,120자가 빠진다. 보내는 글이 달라졌으니 옛 답을 그대로 쓰면 안 된다.
 */
export const DISCOVERY_PROMPT_VERSION = 2

/** 지문을 만들 때 필요한 최소한. 실제 ContrastSet 은 이보다 많은 것을 들고 있다 */
export interface ContrastIdentity {
  winner: { contentId: string }
  peers: readonly { contentId: string }[]
}

/**
 * 이 묶음의 지문.
 *
 * 대조군의 **순서는 뜻이 없다.** 같은 셋이 다른 순서로 와도 AI 에게는 같은 질문이므로
 * 정렬해서 넣는다. 정렬하지 않으면 조회 순서가 바뀌는 날 저장이 통째로 빗나간다.
 *
 * 승자와 대조군은 자리가 다르므로 구분자를 사이에 둔다. 안 그러면
 * (승자 A, 대조 B) 와 (승자 B, 대조 A) 가 같은 지문을 받는다.
 */
export function contrastKey(
  set: ContrastIdentity,
  promptVersion: number = DISCOVERY_PROMPT_VERSION,
): string {
  const winner = set.winner.contentId.trim()
  if (!winner) throw new Error('대조쌍 지문: 승자 id 가 비어 있다')

  const peers = set.peers.map((p) => p.contentId.trim())
  if (peers.some((p) => !p)) throw new Error('대조쌍 지문: 대조군 id 가 비어 있다')

  return `v${promptVersion}:${winner}|${[...peers].sort().join(',')}`
}

/** 저장된 답 한 건. `found:false` 도 답이다 — 「못 찾았다」를 다시 묻지 않기 위해 적는다 */
export interface StoredAnswer {
  found: boolean
  statement: string
  observation: string
  kind: string
}

/**
 * 묶음들을 «이미 아는 것»과 «물어야 하는 것»으로 가른다.
 *
 * 화면이 「새로 물을 것 N건」이라고 말할 수 있어야 사람이 버튼을 누를지 판단한다.
 * 누르기 전에 비용을 모르면, 누르는 사람은 매번 도박을 하는 셈이다.
 */
export function splitByKnown<T extends ContrastIdentity>(
  sets: readonly T[],
  known: ReadonlyMap<string, StoredAnswer>,
  promptVersion: number = DISCOVERY_PROMPT_VERSION,
): { cached: { set: T; key: string; answer: StoredAnswer }[]; fresh: { set: T; key: string }[] } {
  const cached: { set: T; key: string; answer: StoredAnswer }[] = []
  const fresh: { set: T; key: string }[] = []
  const seen = new Set<string>()

  for (const set of sets) {
    const key = contrastKey(set, promptVersion)
    // 한 판 안에 같은 묶음이 두 번 나오면 두 번 묻지 않는다.
    // 저장에 닿기 전이라 저장만으로는 못 거른다
    if (seen.has(key)) continue
    seen.add(key)

    const answer = known.get(key)
    if (answer) cached.push({ set, key, answer })
    else fresh.push({ set, key })
  }
  return { cached, fresh }
}
