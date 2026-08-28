/**
 * 문서 «종이»를 그림으로 (SSOT)
 *
 * **왜 필요한가**: 견적서를 카카오톡·메일 본문에 그대로 붙이고 싶을 때가 있다.
 * PDF 는 열어 봐야 하고, 엑셀은 더 그렇다. 그림은 **누르지 않아도 보인다.**
 *
 * **왜 라이브러리를 안 쓰나**: `html2canvas` 류는 300KB 가 넘고, 우리가 그리는 것은
 * 이미 A4 폭이 고정된 «한 장짜리 문서»다. 브라우저가 가진 `SVG foreignObject → canvas`
 * 로 충분하다 — 의존성이 늘지 않는다.
 *
 * **한계를 알고 쓴다**: foreignObject 는 **외부 리소스를 못 불러온다**.
 * 그래서 이 파일은 ① 스타일을 인라인으로 굽고 ② 이미지를 data URI 로 바꾼 뒤에 그린다.
 * 그래도 실패하면 호출부가 「인쇄로 PDF 저장을 쓰라」고 안내한다 — 조용히 빈 그림을 주지 않는다.
 */

/** 화면 밀도만큼 키워 그린다 — 1배로 그리면 글자가 뭉갠다 */
const SCALE = 2

/** `<img src="http…">` 를 data URI 로. 이미 data URI 면 그대로 둔다 */
async function inlineImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src') ?? ''
    if (!src || src.startsWith('data:')) return
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const data = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result))
        fr.onerror = () => reject(new Error('read failed'))
        fr.readAsDataURL(blob)
      })
      img.setAttribute('src', data)
    } catch {
      // 못 불러온 그림은 **비운다**. 깨진 아이콘이 문서에 박히는 것보다 낫다
      img.removeAttribute('src')
    }
  }))
}

/**
 * 계산된 스타일을 인라인으로 굽는다.
 *
 * foreignObject 안에서는 바깥 스타일시트가 안 걸린다 — 굽지 않으면
 * **글자만 있는 흰 종이**가 나온다(이 함수가 없던 첫 판이 그랬다).
 */
function bakeStyles(source: Element, target: Element): void {
  const computed = getComputedStyle(source)
  const decl: string[] = []
  for (let i = 0; i < computed.length; i += 1) {
    const prop = computed[i]
    const value = computed.getPropertyValue(prop)
    if (value) decl.push(`${prop}:${value}`)
  }
  ;(target as HTMLElement).setAttribute('style', decl.join(';'))

  const sc = Array.from(source.children)
  const tc = Array.from(target.children)
  for (let i = 0; i < sc.length && i < tc.length; i += 1) bakeStyles(sc[i], tc[i])
}

/** 종이 → PNG Blob */
export async function paperToPng(paper: HTMLElement): Promise<Blob> {
  const rect = paper.getBoundingClientRect()
  const width = Math.ceil(rect.width)
  const height = Math.ceil(rect.height)

  const clone = paper.cloneNode(true) as HTMLElement
  bakeStyles(paper, clone)
  await inlineImages(clone)
  // 복제본은 흐름에서 떼어 낸다 — 그림자·변형이 캔버스에 섞이지 않게
  clone.style.margin = '0'
  clone.style.boxShadow = 'none'
  clone.style.width = `${width}px`

  const xml = new XMLSerializer().serializeToString(clone)
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">${xml}</div>` +
    `</foreignObject></svg>`

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('그리지 못했습니다'))
    img.src = url
  })

  const canvas = document.createElement('canvas')
  canvas.width = width * SCALE
  canvas.height = height * SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다')
  // 종이는 흰색이다 — 안 칠하면 투명 배경이라 메신저에서 검게 보인다
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(SCALE, SCALE)
  ctx.drawImage(img, 0, 0)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('이미지를 만들지 못했습니다')
  return blob
}

/** 만들어서 내려받기까지 */
export async function downloadPaperAsPng(paper: HTMLElement, filename: string): Promise<void> {
  const blob = await paperToPng(paper)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 곧바로 지우면 다운로드가 시작되기 전에 사라진다
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ------------------------------------------------------------
// PDF
// ------------------------------------------------------------

/** A4 (mm) */
const A4_W = 210
const A4_H = 297

/**
 * 종이 → **PDF 파일**.
 *
 * **왜 인쇄 대화상자를 안 쓰나**: 「인쇄 → PDF로 저장」은 사용자가 대화상자에서
 * 여백·배율·머리글을 매번 골라야 하고, 고르는 자리를 모르면 두 장짜리 견적서가
 * 그대로 나간다. 그리고 브라우저마다 대화상자가 다르다
 * (사용자 지적: 「인쇄 PDF말고 바로 PDF로 할 수 있는걸로 아는데 … 계속 페이지 넘어가고 있는데」).
 *
 * **여기서는 우리가 페이지를 정한다.** 한 장에 들어가면 한 장, 넘치면 그때만 나눈다.
 *
 * **왜 이미지로 넣나**: 화면에서 보는 그대로가 나가야 «미리보기»다.
 * 글자를 다시 배치하는 방식은 폰트·줄바꿈이 미묘하게 달라져 다른 문서가 된다.
 */
export async function downloadPaperAsPdf(paper: HTMLElement, filename: string): Promise<void> {
  // 동적 import — 견적서를 안 뽑는 사람에게 PDF 라이브러리를 실어 보내지 않는다
  const { jsPDF } = await import('jspdf')

  const blob = await paperToPng(paper)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('read failed'))
    fr.readAsDataURL(blob)
  })

  const rect = paper.getBoundingClientRect()
  // 종이 폭을 A4 폭에 맞춘다 — 그 비율로 높이가 정해진다
  const imgH = (rect.height / rect.width) * A4_W

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true })

  if (imgH <= A4_H + 1) {
    // 한 장에 들어간다 — 위쪽부터 그대로 앉힌다
    pdf.addImage(dataUrl, 'PNG', 0, 0, A4_W, imgH, undefined, 'FAST')
  } else {
    /*
      **넘칠 때만 나눈다.** 한 장 높이만큼씩 위로 밀어 올리며 새 쪽에 같은 그림을 앉힌다 —
      잘린 자리가 글자 한가운데일 수 있지만, 여백을 두려고 배율을 줄이면 글자가 작아진다.
      내용이 길면 두 장이 되는 것이 정직하다(사용자도 그렇게 말했다).
    */
    const pages = Math.ceil(imgH / A4_H)
    for (let i = 0; i < pages; i += 1) {
      if (i > 0) pdf.addPage()
      pdf.addImage(dataUrl, 'PNG', 0, -(A4_H * i), A4_W, imgH, undefined, 'FAST')
    }
  }

  pdf.save(filename)
}
