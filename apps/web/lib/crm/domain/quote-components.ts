/**
 * 합쳐져 온 구성을 **원문 줄 경계로 되가른다**
 *
 * ## 무엇이 문제였나
 *
 * 원본 견적서에는 섀시 한 줄 밑에 사양이 **줄마다 나뉘어** 있다. 그런데 모델이 그것을
 * 규격 한 칸에 이어 붙여 돌려주는 일이 있다 — 그러면 견적서에 한 문단으로 쭉 이어져
 * 어디서 끊기는지 사람이 못 읽는다(사용자 지적 2026-09-21:
 * 「줄바꿈이랑 영역 구분이 안되어 보이니깐 그냥 한문장으로 쭉있는것 같자나」).
 *
 * 지시를 아무리 또렷하게 써도 모델은 가끔 합친다. **그런데 우리는 원문을 갖고 있다.**
 * 합쳐진 글이 원문의 «연속된 줄들을 이어 붙인 것»과 정확히 같으면, 그 경계를 되살릴 수 있다.
 *
 * ## 지어내지 않는다
 *
 * 되가르는 것은 **글자가 정확히 맞아떨어질 때뿐**이다. 한 글자라도 어긋나면 손대지 않는다 —
 * 원문에 없던 줄바꿈을 우리가 만들면 그건 읽은 것이 아니라 지어낸 것이고,
 * 그 문서는 고객에게 나간다.
 */

/** 견줄 때 쓰는 모양 — 공백 차이만 무시한다(줄바꿈·연속 공백은 문서마다 다르다) */
function key(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export interface SplitSpec {
  spec: string
  components: string[]
}

/**
 * 합쳐진 규격을 원문 줄들로 되가른다. 되가를 수 없으면 `null`.
 *
 * @param spec 모델이 준 규격 한 덩어리
 * @param sourceLines 모델에게 넘겼던 원문 줄들(같은 차례)
 */
export function resplitSpec(spec: string, sourceLines: readonly string[]): SplitSpec | null {
  const target = key(spec)
  if (!target) return null

  const lines = sourceLines.map((l) => key(l)).filter(Boolean)

  /*
    **첫 조각은 줄의 «일부»다.** 표 한 행은 「품목 상세내역 수량 금액」이 한 줄로 펴져 오고,
    모델이 규격으로 집는 것은 그 가운데 상세내역 칸뿐이다. 그래서 첫 조각만 줄 안에
    들어 있으면 되고, 그 다음부터는 **줄 전체**가 맞아야 한다 — 이어지는 설명 행은
    칸이 하나뿐이라 줄 전체가 곧 그 내용이다.
  */
  for (let start = 0; start < lines.length; start += 1) {
    const head = headPrefix(lines[start], target)
    if (head === null) continue

    const pieces = [head]
    let at = head.length
    for (let i = start + 1; i < lines.length && at < target.length; i += 1) {
      const next = ` ${lines[i]}`
      if (!target.startsWith(next, at)) break
      at += next.length
      pieces.push(lines[i])
    }

    // **끝까지 맞아떨어질 때만** 되가른다. 남는 글자가 있으면 우리가 모르는 것이 섞인 것이다
    if (at === target.length && pieces.length >= 2) {
      return { spec: pieces[0], components: pieces.slice(1) }
    }
  }
  return null
}

/** 첫 조각으로 쓸 만큼 긴가 — 짧은 조각이 우연히 맞는 것을 막는다 */
const MIN_HEAD = 4

/**
 * 그 줄 안에 들어 있는 **target 의 가장 긴 앞부분**을 찾는다. 없으면 null.
 *
 * 앞부분이 길수록 그 줄에서 온 것이 확실하므로 긴 쪽부터 본다.
 */
function headPrefix(line: string, target: string): string | null {
  for (let len = target.length; len >= MIN_HEAD; len -= 1) {
    const head = target.slice(0, len)
    // 낱말 한가운데서 끊긴 조각은 쓰지 않는다 — 뒤에 이어질 줄과 경계가 어긋난다
    if (len < target.length && target[len] !== ' ') continue
    if (line.includes(head)) return head
  }
  return null
}

/**
 * 읽은 항목 하나를 손본다.
 *
 * **모델이 이미 나눠 줬으면 건드리지 않는다** — 우리가 다시 가르면 모델이 옳게 나눈 것을
 * 원문 줄 모양으로 되돌려 버릴 수 있다.
 */
export function restoreComponents<T extends { spec: string | null; components: string[] }>(
  line: T,
  sourceLines: readonly string[],
): T {
  if (line.components.length > 0) return line
  const spec = (line.spec ?? '').trim()
  if (!spec) return line

  const got = resplitSpec(spec, sourceLines)
  return got ? { ...line, spec: got.spec, components: got.components } : line
}
