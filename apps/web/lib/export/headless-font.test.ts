// 헤드리스로 문서를 굽는 자리가 한글 자형을 빠뜨리지 않는가 — 배선 가드.
//
// 이 가드가 지키는 사고(실측 2026-09-30): 내보낸 PDF·이미지에서 한글만 통째로 빈칸으로 나왔다.
// 서버 크로미움(@sparticuz/chromium@149)이 싣는 글꼴은 Open Sans 셋뿐이라 한글 자형이 0개인데,
// 문서 CSS 는 로컬 macOS 에만 있는 이름들(-apple-system·Apple SD Gothic Neo)을 부르고 있었다.
// **로컬에서는 100% 정상**이라 단위 시험도 눈으로 보는 것도 이 고장을 못 잡는다.
// 그래서 여기서 재는 것은 「굽는 자리가 자형을 얹는 함수를 지나는가」다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** 저장소에서 puppeteer 로 문서를 굽는 자리를 전부 찾는다 — 손목록을 만들지 않는다. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.next') || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

const ROOT = process.cwd()
const FILES = ['app', 'lib', 'components'].flatMap((d) => walk(path.join(ROOT, d)))
const RENDERERS = FILES.filter((f) => {
  const src = readFileSync(f, 'utf8')
  return src.includes('page.setContent(') || src.includes("import('puppeteer-core')")
}).map((f) => path.relative(ROOT, f))

test('헤드리스로 문서를 굽는 자리를 실제로 찾아낸다 — 0곳이면 이 가드는 눈이 먼 것이다', () => {
  assert.ok(RENDERERS.length > 0, '굽는 자리를 하나도 못 찾았습니다 — 탐색 규칙이 낡았습니다')
})

test('문서를 굽는 자리는 한글 자형을 얹는 한 자리를 지난다 — 복붙본이 생기면 또 한 곳만 고쳐진다', () => {
  // 자형을 얹는 그 한 자리(render-document)와, 자형 바이트를 만드는 자리(embed-korean-font)는 예외다
  const OWNERS = ['lib/export/render-document.ts', 'lib/export/embed-korean-font.ts']
  // 밖에서 온 주소를 렌더해 HTML 만 뽑는 자리 — 사람에게 보여 줄 문서를 굽지 않으므로 자형이 필요 없다
  const NOT_A_DOCUMENT: Record<string, string> = {
    'lib/security/headless-fetch.ts': '남의 사이트를 렌더해 HTML 문자열만 얻는다 — 파일로 나가는 문서가 아니다',
  }
  const offenders = RENDERERS.filter((f) => !OWNERS.includes(f) && !(f in NOT_A_DOCUMENT))
  assert.deepEqual(offenders, [],
    '이 자리들이 굽기를 직접 하고 있습니다 — lib/export/render-document.ts 의 renderDocument 를 쓰세요:\n  '
    + offenders.join('\n  ')
    + '\n직접 구우면 한글 자형이 안 얹혀 파일에서 한글이 전부 빈칸으로 나갑니다(실측 2026-09-30).')
})

test('자형을 얹는 그 한 자리가 실제로 자형을 부르고 기다린다 — 부르지 않으면 이름만 남은 것이다', () => {
  const src = readFileSync(path.join(ROOT, 'lib/export/render-document.ts'), 'utf8')
  assert.match(src, /buildKoreanFontCss\(/, '자형을 만드는 함수를 안 부릅니다')
  assert.match(src, /addStyleTag\(/, '만든 자형을 문서에 안 얹습니다')
  assert.match(src, /document\.fonts\.ready/, '자형이 붙기 전에 찍으면 빈칸이 그대로 박힙니다')
  // 순서가 뒤집히면(기다린 뒤에 얹으면) 아무 소용이 없다. 선언 위치가 아니라 **부르는 자리**를 본다.
  const body = src.slice(src.indexOf('export async function renderDocument'))
  const laid = body.indexOf('addStyleTag(')
  const waited = body.indexOf('waitForFonts(page)')
  assert.ok(laid >= 0 && waited >= 0 && laid < waited, '자형을 기다린 뒤에 얹고 있습니다')
  // 찍기가 기다림보다 앞서면 빈칸이 그대로 파일에 박힌다
  const shot = Math.min(...['screenshot(', 'page.pdf('].map((c) => { const i = body.indexOf(c); return i < 0 ? Infinity : i }))
  assert.ok(waited < shot, '자형을 기다리기 전에 찍고 있습니다')
})

test('문서 글꼴 차례 맨 앞이 들고 가는 자형이다 — 내보내기 문서 전부', () => {
  for (const f of ['lib/meeting/export-html.ts', 'lib/ai-chat/export.ts']) {
    const src = readFileSync(path.join(ROOT, f), 'utf8')
    const m = /font-family:\s*([^;]+);/.exec(src)
    assert.ok(m, `${f} 에 글꼴 차례가 없습니다`)
    assert.ok(m![1].includes('EXPORT_FONT_STACK'),
      `${f} 가 글꼴 차례를 따로 적고 있습니다(${m![1]}) — 서버에 없는 이름을 부르면 한글이 빈칸입니다`)
  }
})
