/**
 * 원본 **조각** — 그 건이 있던 쪽만 오려 견적에 붙인다
 *
 * ## 왜 필요한가
 *
 * 한 파일에 견적이 두 건 들어 있으면 지금까지는 그 둘에 **같은 파일이 통째로** 붙었다.
 * 대조 화면은 1쪽부터 열리고, 사람이 그 안에서 자기 건을 찾아야 했다
 * (사용자 지적 2026-09-20: 「거기 두개가 들어 있는데 찾아서 확인해야 하자나 너무 허접한거지」).
 *
 * ## 넘겨짚지 않는다
 *
 * 쪽을 모르면 **안 오린다.** 틀린 쪽에서 오린 그림은 맞는 것처럼 보이기 때문에,
 * 안 오린 것보다 나쁘다. 그때는 예전처럼 파일 전체를 붙이고 대조도 전체로 연다.
 *
 * ## 판단과 그리기를 가른다
 *
 * `planSnapshot` 은 **브라우저를 모른다.** 순수 함수라 「설정을 끄면 안 만드나」
 * 「쪽이 없으면 안 만드나」를 실제로 돌려 볼 수 있다. 그리기(`renderPdfPage`)는
 * 캔버스가 있는 곳에서만 돌고, 실패하면 null 을 준다 — 조각이 없는 것은 견적이
 * 안 만들어지는 것보다 훨씬 가벼운 일이다.
 */

/** 조각을 만들지, 안 만든다면 왜 */
export type SnapshotSkip = 'off' | 'not_drawable' | 'no_page'

export type SnapshotPlan =
  | { make: true; page: number }
  | { make: false; reason: SnapshotSkip }

export interface SnapshotPlanInput {
  /** 설정에서 켜 뒀나 (`quote.import.snapshot`) */
  enabled: boolean
  /** 원본 파일의 형식. 지금 오릴 수 있는 것은 PDF 뿐이다 */
  mimeType: string | null
  /** 그 건이 시작하는 쪽. 못 읽었으면 null */
  pageStart: number | null
}

/**
 * 오릴까 말까. **순수 함수다.**
 *
 * 그림 파일은 오리지 않는다 — 이미 한 장이고, 그 한 장이 곧 그 건이다.
 * 엑셀·한글은 쪽이라는 것이 없어 오릴 자리를 정할 수 없다.
 */
export function planSnapshot(input: SnapshotPlanInput): SnapshotPlan {
  if (!input.enabled) return { make: false, reason: 'off' }
  if ((input.mimeType ?? '').toLowerCase() !== 'application/pdf') {
    return { make: false, reason: 'not_drawable' }
  }
  if (input.pageStart === null || !Number.isFinite(input.pageStart) || input.pageStart < 1) {
    return { make: false, reason: 'no_page' }
  }
  return { make: true, page: Math.floor(input.pageStart) }
}

/**
 * 조각 파일 이름.
 *
 * **원본 이름을 앞에 둔다.** 견적 첨부 목록에서 원본과 조각이 나란히 서는데,
 * 조각이 다른 이름으로 시작하면 같은 문서에서 나온 둘로 안 보인다.
 */
export function snapshotFileName(originalName: string, page: number): string {
  const base = originalName.replace(/\.[^.]+$/, '').replace(/[/\\:*?"<>|]/g, '').trim()
  return `${base || '원본'}_${page}쪽.png`
}

/** 그린 그림의 가로 크기. 대조 화면 절반에서 글자가 읽히는 선이다 */
export const SNAPSHOT_WIDTH = 1400

/**
 * PDF 한 쪽을 PNG 로 그린다. **브라우저에서만 돈다.**
 *
 * 못 그리면 `null` — 부르는 쪽은 그때 조각 없이 넘어간다.
 * 그리기 도구는 **이 함수 안에서만** 불러온다. 위에서 import 하면 견적 화면을 열기만 해도
 * 그 무게를 같이 지고, 대조를 안 여는 사람까지 값을 치른다.
 */
export async function renderPdfPage(
  bytes: ArrayBuffer,
  page: number,
  width: number = SNAPSHOT_WIDTH,
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  try {
    const pdfjs = await import('pdfjs-dist')
    // 일꾼 파일은 꾸러미가 넣어 준다 — 주소를 손으로 적으면 배포에서만 404 가 난다
    pdfjs.GlobalWorkerOptions.workerSrc =
      new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
    if (page < 1 || page > doc.numPages) return null
    const pdfPage = await doc.getPage(page)

    const base = pdfPage.getViewport({ scale: 1 })
    const viewport = pdfPage.getViewport({ scale: width / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png')
    })
  } catch {
    // 조각이 없는 것은 견적이 안 만들어지는 것보다 훨씬 가벼운 일이다
    return null
  }
}
