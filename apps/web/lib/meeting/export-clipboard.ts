// 내보내기 문서를 클립보드에 담는다 (SSOT · 순수 계산 + 얇은 배선).
//
// 왜 복사가 필요한가(사용자 지시 2026-09-30): 파일로 받아 열어 다시 붙여넣는 길밖에 없었다.
// 메일·메신저·노션에 회의록을 옮기는 일이 가장 잦은데 그 길이 가장 멀었다.
//
// 두 벌을 같이 담는 이유: 받는 쪽마다 읽는 것이 다르다. 워드·노션은 text/html 을 읽어 표와
// 글머리표를 살리고, 메모장·터미널은 text/plain 만 읽는다. 하나만 담으면 한쪽이 망가진다.
import { htmlToPlain } from '../html-to-plain.ts'

/**
 * 내보내기 문서 HTML → 붙여넣을 글자판.
 *
 * `htmlToPlain` 은 표를 모른다(`</td>`·`</th>`·`</tr>` 를 안 본다) — 그대로 넘기면
 * 라벨-값 표가 「작성일시2026년…작성자김도현」 한 덩어리로 뭉개진다. 그래서 표와 절 번호를
 * 먼저 줄로 펴고 나머지는 SSOT 에 맡긴다(변환 규칙을 두 벌로 만들지 않는다).
 */
export function exportHtmlToPlain(html: string): string {
  return htmlToPlain(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, '')            // <style>·<title> 이 글자로 새지 않게
      // 템플릿이 읽기 좋으라고 넣은 들여쓰기 — 태그 **앞**에 있는 것만 지운다.
      // 사람이 쓴 글의 들여쓰기는 태그가 아니라 글자 앞에 있으므로 안 건드린다.
      .replace(/\n[ \t]+(?=<)/g, '\n')
      .replace(/<span class="no">(\d+)<\/span>/gi, '$1. ') // 절 번호 배지 → 「1. 」
      .replace(/<\/th\s*>\s*/gi, ': ')                    // 라벨 뒤는 콜론
      .replace(/<\/td\s*>\s*/gi, '\t')                    // 칸 사이는 탭(전사의 시각·화자 칸이 안 붙게)
      .replace(/<\/tr\s*>\s*/gi, '\n')                    // 줄바꿈은 행 끝에서 한 번만
      .replace(/<\/(h1|h2|h3)\s*>\s*/gi, '\n'),
  )
    .split('\n')
    .map((l) => l.replace(/\t+$/, '').trimEnd())          // 행 끝에 남은 빈 칸 표시를 지운다
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** 복사가 어떻게 끝났나 — 화면이 사람에게 할 말을 고르는 근거 */
export type CopyResult = 'rich' | 'text'

/** 진짜 `navigator` 와 시험용 대역이 둘 다 들어맞는 최소 모양 */
interface ClipboardLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clipboard?: { write?: (items: any) => Promise<void>; writeText?: (s: string) => Promise<void> }
}

/**
 * 문서를 클립보드에 담는다. 서식과 글자를 **같이** 담고, 못 담으면 글자만 담는다.
 *
 * 반환값으로 어느 쪽이었는지 알린다 — 조용히 글자만 담아 놓고 「복사했습니다」라고만 하면
 * 표가 사라진 채 붙여넣어지고, 사용자는 왜인지 모른다.
 * 둘 다 안 되면 **던진다**: 아무 일도 안 일어났는데 성공했다고 말하지 않는다.
 */
export async function copyExportDocument(
  html: string,
  nav: ClipboardLike = typeof navigator === 'undefined' ? {} : navigator,
  Item: typeof ClipboardItem | undefined = typeof ClipboardItem === 'undefined' ? undefined : ClipboardItem,
): Promise<CopyResult> {
  const text = exportHtmlToPlain(html)
  if (Item && nav.clipboard?.write) {
    try {
      await nav.clipboard.write([new Item({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })])
      return 'rich'
    } catch { /* 서식 담기가 막히면 글자라도 담는다 — 아래로 내려간다 */ }
  }
  if (!nav.clipboard?.writeText) throw new Error('이 브라우저에서는 복사할 수 없습니다')
  await nav.clipboard.writeText(text)
  return 'text'
}
