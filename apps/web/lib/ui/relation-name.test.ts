/**
 * **id 로 링크를 걸었으면 이름을 보여 준다** — 정적 가드
 *
 * 왜: 「딜」·「회사 열기」처럼 **종류만 적힌 링크**는 눌러 봐야 어느 것인지 알 수 있다.
 * 붙은 것을 보러 온 자리에서 무엇이 붙었는지를 안 알려 주는 셈이다
 * (사용자 지적: 「이거 너는 어떤 딜인지 알겠니? 왜 친절하지가 않아?」).
 *
 * 이 가드가 잡는 것은 **한 가지**다: `/crm/{deals|companies|people}/{id}` 로 가는 링크의
 * 글자가 «종류 이름»뿐인 것. 실제 이름이 들어가면 통과한다.
 *
 * 잡지 않는 것: 버튼·아이콘 링크(이름을 쓸 자리가 없다)와 이미 이름을 그리는 링크.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { walkFiles } from './component-scan.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')

/** 링크 글자가 이것뿐이면 «어느 것인지» 를 말하지 않는 것이다 */
const BARE = [
  '딜', '회사', '인물', '거래처', '담당자',
  '딜 열기', '회사 열기', '인물 열기',
  '보기', '열기', '이동', '바로가기',
]

/**
 * 이름을 쓸 자리가 없는 곳 — 이유를 함께 적는다.
 * 여기 넣을 때는 «왜 이름이 없어도 되는가»가 분명해야 한다.
 */
const ALLOW: Record<string, string> = {}

test('★ id 링크는 종류가 아니라 이름을 보여 준다', () => {
  const files = [
    ...walkFiles(join(WEB, 'app', '(crm)'), ['.tsx']),
    ...walkFiles(join(WEB, 'components', 'ui', 'crm'), ['.tsx']),
  ]

  // 스캐너가 죽으면 위반을 못 잡고도 초록이 된다 — 살아 있음을 먼저 단정한다
  assert.ok(files.length > 20, `스캔 대상이 너무 적다(${files.length}) — 경로를 확인하라`)

  const bad: string[] = []
  for (const file of files) {
    const rel = relative(WEB, file)
    if (ALLOW[rel]) continue
    const src = readFileSync(file, 'utf8')

    // `href={`/crm/deals/${…}`}` 로 열고 `</Link>` 또는 `</a>` 로 닫는 한 덩어리
    const re = /href=\{`\/crm\/(?:deals|companies|people)\/\$\{[^}]*\}`\}[^>]*>([\s\S]{0,120}?)<\/(?:Link|a)>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      // JSX 식({…})이 들어 있으면 값을 그리는 것이다 — 정적으로는 이름으로 본다
      const inner = m[1]
      if (inner.includes('{')) continue
      const text = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
      if (!text) continue                       // 아이콘만 있는 링크
      if (!BARE.includes(text)) continue        // 그 밖의 글자는 이름으로 본다
      bad.push(`${rel} — 「${text}」`)
    }
  }

  assert.deepEqual(bad, [],
    `id 로 링크하면서 이름을 안 보여 줍니다. 링크 글자를 그 대상의 이름으로 바꾸세요:\n${bad.join('\n')}`)
})
