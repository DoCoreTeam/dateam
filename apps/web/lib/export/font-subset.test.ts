// 내보낸 문서가 한글 자형을 들고 가는가 — 고르는 규칙 가드.
//
// 이 가드가 지키는 사고(실측 2026-09-30): 내보낸 PDF·이미지에서 한글만 빈칸으로 나왔다.
// 서버 크로미움에 한글 자형이 하나도 없어서였다(@sparticuz/chromium 은 Open Sans 셋만 싣는다).
// 그래서 여기서 재는 것은 "몇 개를 골랐나"가 아니라 **문서의 글자가 실제로 덮이는가**다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { EXPORT_FONT_FAMILY, EXPORT_FONT_STACK, fontFaceCss, parseFontFaces, pickKoreanFontFaces } from './font-subset.ts'

const CSS = readFileSync(path.join(process.cwd(), 'public/fonts/fonts.css'), 'utf8')
const FACES = parseFontFaces(CSS, 'Pretendard Variable')

test('fonts.css 에서 Pretendard 조각을 읽어 낸다 — 표를 두 벌 만들지 않는다', () => {
  assert.ok(FACES.length > 50, `Pretendard 조각이 ${FACES.length}개뿐입니다 — fonts.css 를 못 읽었거나 형식이 바뀌었습니다`)
  // 다른 가족(Nanum Pen Script)이 섞이면 문서가 손글씨로 나간다
  assert.ok(FACES.every((f) => f.file.startsWith('fonts/pretendard/')), '다른 글꼴 가족이 섞였습니다')
  assert.ok(FACES.every((f) => f.ranges.length > 0), 'unicode-range 를 못 읽은 조각이 있습니다')
})

test('문서에 쓰인 글자를 덮는 조각만 고른다 — 92개를 다 싣지 않고, 0개도 아니다', () => {
  const picked = pickKoreanFontFaces('회의록', FACES)
  assert.ok(picked.length > 0, '한글인데 고른 조각이 0개입니다 — 문서가 빈칸으로 나갑니다')
  assert.ok(picked.length < FACES.length, `${picked.length}/${FACES.length} — 세 글자에 전부를 싣고 있습니다`)
})

test('고른 조각이 문서의 모든 한글을 실제로 덮는다 — 한 글자라도 새면 그 자리가 빈칸이다', () => {
  // 실제 사고 이미지에 있던 말들. 한글·로마자·숫자가 섞인 보통의 회의록 문장이다.
  const text = '김태형 실장 인수인계 정리 — Onedrive 백업, 계약 1,400건, VPN 및 Dooray 이관 (10월 2일)'
  const picked = pickKoreanFontFaces(text, FACES)
  const covered = (cp: number) => picked.some((f) => f.ranges.some(([a, b]) => cp >= a && cp <= b))
  const missing = [...text].filter((ch) => {
    const cp = ch.codePointAt(0)!
    return cp > 0x2f && !covered(cp) // 공백·구두점은 어느 조각이든 폴백으로 그려진다
  })
  assert.deepEqual(missing, [], `자형이 없는 글자: ${missing.join('')}`)
})

test('로마자·숫자뿐이면 거의 안 싣는다 — 안 쓰는 자형을 들고 다니지 않는다', () => {
  // 조각은 빈도순으로 묶여 있어 로마자 조각에 한글 몇 자가 섞여 있다. 그래서 0 이 아니라 «몇 개» 로 잰다.
  const picked = pickKoreanFontFaces('SaaS WBS VPN 2026', FACES)
  assert.ok(picked.length <= 2, `로마자뿐인데 ${picked.length}개를 싣고 있습니다`)
})

test('한글이 많이 흩어져도 전부를 싣지는 않는다 — 매번 3MB 를 들고 가면 안 된다', () => {
  // 한글 음절 600자를 일부러 넓게 흩뿌린 최악에 가까운 문서
  const scattered = Array.from({ length: 600 }, (_, i) => String.fromCharCode(0xac00 + i * 3)).join('')
  const picked = pickKoreanFontFaces(scattered, FACES)
  assert.ok(picked.length > 0 && picked.length < FACES.length * 0.6,
    `${picked.length}/${FACES.length} — 고르는 의미가 없습니다`)
})

test('문서에 박는 한 줄에 자형 바이트와 unicode-range 가 둘 다 있다', () => {
  const css = fontFaceCss('AAAA', 'U+ac00-d7a3')
  assert.match(css, /src:url\(data:font\/woff2;base64,AAAA\)/, '자형 바이트가 안 실렸습니다 — 네트워크에 기대면 안 됩니다')
  assert.match(css, /unicode-range:U\+ac00-d7a3/, 'unicode-range 가 사라졌습니다')
  assert.ok(css.includes(EXPORT_FONT_FAMILY), '문서가 부르는 이름과 다른 이름으로 실렸습니다')
})

test('글꼴 차례 맨 앞이 들고 가는 자형이다 — 시스템 글꼴을 먼저 찾으면 서버에서 또 빈칸이다', () => {
  assert.ok(EXPORT_FONT_STACK.startsWith(EXPORT_FONT_FAMILY), `글꼴 차례가 ${EXPORT_FONT_STACK} 로 시작합니다`)
})
