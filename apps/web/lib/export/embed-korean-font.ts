// 고른 자형을 실제로 읽어 문서에 박는다 (서버 전용).
//
// 고르는 규칙은 font-subset.ts 에 있다(순수 함수 · 단위 시험 대상). 여기는 I/O 만 한다.
// data: URI 로 박는 이유: 네트워크·CORS·CSP 어느 것에도 기대지 않는다. 람다가 자기 CDN 을
// 다시 불러오게 만들면 그 왕복이 새 고장 지점이 되고, 고장 났을 때 증상은 또 「빈칸」이다.
import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { recordSystemEvent } from '../system-log/record.ts'
import { EXPORT_FONT_FAMILY, fontFaceCss, parseFontFaces, pickKoreanFontFaces, type FontFace } from './font-subset.ts'

export { EXPORT_FONT_FAMILY, EXPORT_FONT_STACK } from './font-subset.ts'

/** 배포본에서 public/ 이 어디 있나. 모노레포라 cwd 가 저장소 루트일 수도 apps/web 일 수도 있다. */
function publicPath(rel: string): string {
  const cwd = process.cwd()
  const base = cwd.endsWith(`${path.sep}apps${path.sep}web`) ? cwd : path.join(cwd, 'apps', 'web')
  return path.join(base, 'public', rel)
}

let cached: FontFace[] | null = null

async function loadFaces(): Promise<FontFace[]> {
  if (!cached) {
    const css = await readFile(publicPath('fonts/fonts.css'), 'utf8')
    cached = parseFontFaces(css, EXPORT_FONT_FAMILY.replace(/'/g, ''))
  }
  return cached
}

/**
 * 이 문서를 그리는 데 필요한 한글 글꼴 CSS. 헤드리스 렌더 직전에 문서에 넣는다.
 *
 * 못 읽으면 **빈 문자열을 조용히 돌려주지 않는다** — 이번 사고의 본체가 바로 그것이었다.
 * 글꼴이 없어도 파일은 나와야 하므로(내보내기 자체를 막지는 않는다) 빈 문자열을 돌려주되,
 * 왜 그랬는지를 시스템 로그에 남긴다. 그래야 다음 사람이 두 달을 안 헤맨다.
 */
export async function buildKoreanFontCss(text: string, where: string): Promise<string> {
  try {
    const faces = await loadFaces()
    if (faces.length === 0) throw new Error('fonts.css 에서 Pretendard 조각을 하나도 못 찾았습니다')
    const picked = pickKoreanFontFaces(text, faces)
    if (picked.length === 0) return '' // 로마자·숫자뿐인 문서 — 실을 자형이 없는 것이 정상이다
    const rules = await Promise.all(picked.map(async (f) =>
      fontFaceCss((await readFile(publicPath(f.file))).toString('base64'), f.unicodeRange),
    ))
    return rules.join('\n')
  } catch (err) {
    // 서버 콘솔은 아무도 안 본다. 관리자가 「무엇이 왜 빈칸인지」를 알 수 있는 자리에 남긴다.
    await recordSystemEvent({
      source: 'host_api', error: err, feature: 'export-korean-font',
      route: where, blocksUser: false,
      context: { cwd: process.cwd(), chars: text.length },
    }).catch(() => { /* 기록 실패가 내보내기를 막지 않는다 */ })
    return ''
  }
}
