/**
 * 문서를 한 장에 넣는 배율 (SSOT)
 *
 * **왜 컴포넌트 밖에 있나**: 예전 판은 이 계산이 `DocSurface` 의 `useEffect` 안에
 * 두 줄로 들어 있었다. 그 자리의 식은 **실브라우저 말고는 검증할 방법이 없어서**,
 * 여백을 두 번 빼는 오차가 들어간 채로 아무도 모르고 지나갔다(완료 조건 E-6).
 * 여기로 빼면 숫자로 잠글 수 있다.
 *
 * **무엇이 틀렸었나** (v0.7.701 까지):
 *  ① 한 쪽 높이를 `297 − 30밀리` 로 잡았다. 그런데 재는 대상인 종이는 자기 여백을
 *     **이미 품고 있고** `@page` 여백은 0 이다 — 여백을 두 번 뺀 것이라 쓸 수 있는
 *     높이를 **11퍼센트 적게** 봤다. 그래서 한 장이 될 문서도 하한에 걸려 포기했다.
 *  ② 배율을 `transform: scale()` 로 걸었다. transform 은 **그리기**이고 쪽 나눔은
 *     **배치**에서 정해지므로, 줄여도 쪽 수가 그대로다.
 *     (실측 · 크롬 · 같은 내용 같은 배율 0.88 → transform 2쪽 · zoom 1쪽)
 *
 * 지금은 `zoom` 을 쓴다. `zoom` 은 배치에 영향을 주므로 쪽 수가 실제로 준다.
 */

/** A4 한 장의 높이(CSS px). `@page` 여백이 0 이므로 **이것이 곧 쓸 수 있는 높이**다 */
export const A4_PAGE_H_PX = (297 / 25.4) * 96

/** A4 폭(밀리) — PDF·인쇄가 공유한다 */
export const A4_W_MM = 210
/** A4 높이(밀리) */
export const A4_H_MM = 297

/**
 * 더 줄이지 않는 선.
 *
 * 이 밑으로 내려가면 견적서 표의 글자가 종이에서 읽기 어려워진다.
 * 그때는 **두 장이 맞다** — 억지로 한 장에 넣는 것이 친절이 아니다.
 */
export const MIN_FIT = 0.85

/**
 * 계산한 배율에 조금 여유를 둔다.
 *
 * 딱 맞게 계산하면 반올림 한 픽셀 때문에 두 번째 쪽이 생긴다 —
 * 그 쪽에는 아무것도 안 보이는데 인쇄기는 종이를 한 장 더 뱉는다.
 */
export const FIT_SAFETY = 0.995

/** 재고 줄이기를 몇 번까지 하나 — 실측상 3회면 멈춘다 */
export const MAX_FIT_PASSES = 4

/** 배율을 하한과 1 사이로 자른다 */
export function clampFit(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(MIN_FIT, value))
}

/** 이 높이가 한 장에 들어가나 — 반올림 한 픽셀은 봐준다 */
export function fitsOnePage(measuredPx: number, pageH: number = A4_PAGE_H_PX): boolean {
  return measuredPx <= pageH + 1
}

/**
 * 지금 배율에서 잰 높이를 보고 **다음 배율**을 정한다.
 *
 * 한 번에 안 맞는 이유: 글자가 작아지면 한 줄에 더 많이 들어가 **줄바꿈이 바뀐다.**
 * 그래서 줄여 놓고 다시 재야 한다(실측: 0.881 로 줄였더니 1130px 이라 여전히 넘쳤고,
 * 0.871 에서 1119px 로 들어갔다).
 */
export function nextFit(
  current: number,
  measuredPx: number,
  pageH: number = A4_PAGE_H_PX,
): number {
  if (measuredPx <= 0) return current
  return clampFit(current * (pageH / measuredPx) * FIT_SAFETY)
}

/** 화면에 보여 줄 배율 — 「91%」 */
export function fitPercent(value: number): number {
  return Math.round(value * 100)
}

/**
 * 사용자가 손으로 조절할 때 쓰는 눈금.
 *
 * 자동 배율이 마음에 안 들 때 5퍼센트씩 움직인다. 하한 아래로는 못 내려간다 —
 * 내려갈 수 있게 두면 「왜 이렇게 작지」가 우리 탓이 아닌 것이 되어 버린다.
 */
export const FIT_STEP = 0.05

export function stepFit(value: number, direction: 1 | -1): number {
  return clampFit(Math.round((value + FIT_STEP * direction) * 100) / 100)
}

/**
 * 종이 그림을 PDF 로 앉힐 때 **종이 크기**를 정한다.
 *
 * **왜 자르지 않나**: 예전 판은 긴 그림을 A4 높이마다 잘라 여러 쪽으로 만들었다.
 * 자르는 자리가 내용과 아무 상관이 없어 **글자 한가운데가 잘릴 수 있었다.**
 * (사용자 지적: 「이미지는 (두 장이) 아니잖아? PDF 도 이미지라면 같은 맥락 아닌지」)
 *
 * 그래서 규칙을 둘로 줄였다:
 *  · 한 장에 들어가면 → **A4 한 장**
 *  · 안 들어가면 → **자르지 않고 내용 길이대로 한 장** (이미지와 같은 맥락)
 *
 * A4 여러 장이 필요하면 「인쇄」를 쓴다 — 거기서는 브라우저가 **내용 경계**에서 끊는다
 * (거래 조건·특기사항은 통째로 넘어가도록 규칙을 걸어 두었다).
 */
export function pdfPageSize(imageHeightMm: number): { widthMm: number; heightMm: number; a4: boolean } {
  if (imageHeightMm <= A4_H_MM + 1) {
    return { widthMm: A4_W_MM, heightMm: A4_H_MM, a4: true }
  }
  return { widthMm: A4_W_MM, heightMm: imageHeightMm, a4: false }
}
