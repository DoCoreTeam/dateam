// lib/crm/ui/pipeline-count.ts — 파이프라인에 딜이 몇 건인가 (SSOT)
//
// ## 왜 생겼나 (사용자 지적 2026-09-08)
//
// *"다섯개인데 왜 총 7개인 걸로 나오지?"*
//
// 딜 목록은 「수주 총액 5건」이라 말하는데 보드의 파이프라인 셀렉트는 「전체 (7개)」였다.
// 둘은 애초에 **다른 것을 세고 있었다** — 7은 파이프라인 수, 5는 딜 수다.
//
// 더 나쁜 것은 그 둘이 **한 드롭다운 안에 나란히** 있었다는 점이다:
//
//   파이프라인 전체 (7개)   ← 파이프라인 수
//   GPU 인프라 (2)          ← 딜 수
//   공공 (3)                ← 딜 수
//
// 같은 자리, 같은 괄호 표기, 다른 뜻이다. 읽는 사람은 첫 줄도 딜 수로 읽는다 —
// 나머지 줄이 전부 그러니까. 그래서 「전체를 고르면 7건이 보이겠구나」로 읽고,
// 표로 넘어가 5건을 보고 어긋난다.
//
// ## 무엇이 구조적 원인이었나
//
// 세는 식이 **한 파일 안에 두 벌** 있었다(`DealsClient.tsx` 110행·191행).
// 두 벌이면 한쪽 라벨만 바뀌어도 아무도 모른다. 세는 자리를 하나로 모으면
// 「전체」와 형제 줄이 **구조적으로** 같은 것을 세게 된다.
//
// (같은 부류의 앞선 지적: 「숫자는 뭐야? 1 2 6?」 — 같은 자리의 숫자는 뜻이 하나여야 한다.)

/** 보드가 그리는 파이프라인의 최소 모양 — 단계마다 딜 수를 갖는다 */
export interface CountablePipeline {
  stages: { dealCount?: number }[]
}

/** 이 파이프라인에 딜이 몇 건인가 */
export function dealsInPipeline(p: CountablePipeline): number {
  return p.stages.reduce((n, s) => n + (s.dealCount ?? 0), 0)
}

/** 이 워크스페이스에 딜이 몇 건인가 — 「전체」가 뜻하는 수 */
export function dealsInPipelines(ps: CountablePipeline[]): number {
  return ps.reduce((n, p) => n + dealsInPipeline(p), 0)
}
