// lib/ui/integration-consistency.test.ts — 동종 UI 통일 가드 (CLAUDE.md §2-5)
//
// 정책을 문서에만 적어두면 다음 사람이 또 인라인으로 만든다.
// design:check는 hex·치수만 보므로 "용어가 갈렸다 / 기능이 빠졌다"는 못 잡는다.
// 이 정적 스캔이 그 자리를 맡는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SETTINGS_DIR = join(process.cwd(), 'app/admin/settings')

/** 연동 카드 = 외부 서비스 자격증명을 다루는 설정 컴포넌트 */
// AI 공급자 카드 다섯(Gemini Claude OpenAI Groq 음성인식)은 여기 없다 —
// 파일이 다섯이 아니라 AiProviderCard 한 벌이고, 명세를 훑어 그린다.
// 손목록에 없다고 검사를 건너뛰는 것이 아니라, 검사할 「카드 파일」이 하나로 줄어든 것이다.
const INTEGRATION_CARDS = [
  'AiProviderCard.tsx',
  'YoutubeSettings.tsx',
  'KoraeximSettings.tsx',
  'GoogleDriveSettings.tsx',
  'DbSettings.tsx',
  'VercelSettings.tsx',
  'G2bSettings.tsx',
]

function read(file: string): string {
  return readFileSync(join(SETTINGS_DIR, file), 'utf-8')
}

/** JSX 텍스트 노드(사용자에게 보이는 말)만 훑는다 — 주석·문서 문자열은 제외 */
function visibleText(src: string): string {
  return src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n')
}

test('§2-5(2) 용어: 연동 카드에 "헬스체크"가 남아 있으면 안 된다 (→ 연결 테스트)', () => {
  const offenders = INTEGRATION_CARDS.filter((f) => visibleText(read(f)).includes('헬스체크'))
  assert.deepEqual(offenders, [],
    `용어가 갈렸다. LABEL.test("연결 테스트")를 쓸 것: ${offenders.join(', ')}`)
})

test('§2-5(2) 용어: 연동 해제를 "삭제"라 부르지 않는다 (→ 연결 해제)', () => {
  // "삭제"는 데이터를 지우는 행위에만 쓴다. 버튼 라벨로 등장하면 위반.
  const offenders = INTEGRATION_CARDS.filter((f) => /[>\s]삭제\s*</.test(visibleText(read(f))))
  assert.deepEqual(offenders, [],
    `연동 끊기는 LABEL.disconnect("연결 해제")다: ${offenders.join(', ')}`)
})

test('§2-5(2) 저장 버튼 라벨은 언제나 "저장" — 카드별 변형 금지', () => {
  const files = readdirSync(SETTINGS_DIR).filter((f) => f.endsWith('.tsx'))
  const offenders = files.filter((f) => /테마 적용|적용하기|등록하기/.test(visibleText(read(f))))
  assert.deepEqual(offenders, [], `저장 라벨 변형 발견: ${offenders.join(', ')}`)
})

test('★ 목록 자체를 검사한다 — 새 연동 카드가 조용히 빠지면 아래 가드가 전부 무력해진다', () => {
  // 실측(v0.7.595): VercelSettings.tsx 를 새로 만들었는데 이 손목록에 없어서
  // "삭제 서버액션을 UI가 안 부른다"는 **틀린 판정**이 나왔다. 반대 방향(진짜 위반을 놓치는 것)이
  // 더 위험하다 — 목록에 없는 카드는 §2-5 검사를 통째로 건너뛴다.
  const declared = new Set(INTEGRATION_CARDS)
  const missing = readdirSync(SETTINGS_DIR)
    .filter((f) => f.endsWith('Settings.tsx') && !declared.has(f))
    .filter((f) => /from '\.\/integration-ui'/.test(read(f)))
  assert.deepEqual(missing, [],
    `연동 카드인데 INTEGRATION_CARDS 에 없다(§2-5 검사를 건너뛴다): ${missing.join(', ')}`)
})

test('§2-5(1) 연동 카드는 공용 부품(integration-ui)을 쓴다 — 상태 블록 자작 금지', () => {
  const offenders = INTEGRATION_CARDS.filter((f) => {
    const s = read(f)
    // 공용 부품을 안 쓰면서 성공 배경으로 상태 박스를 직접 그리는 경우
    return !/from '\.\/integration-ui'/.test(s) && s.includes('var(--success-bg)')
  })
  assert.deepEqual(offenders, [],
    `IntegrationStatus를 쓸 것(카드마다 다른 상태 박스 금지): ${offenders.join(', ')}`)
})

test('§2-5(3) 기능: 삭제 서버액션이 있으면 UI가 반드시 호출한다', () => {
  // 실제 사고 — deleteClaudeKey·deleteOpenAiKey가 있는데 UI가 안 불러
  // "삭제가 없는 카드"처럼 보였다. 있는 기능을 숨기지 않는다.
  const actions = read('actions.ts')
  const deleteFns = [...actions.matchAll(/export async function (delete\w+)/g)].map((m) => m[1])
  assert.ok(deleteFns.length > 0, '삭제 서버액션을 하나도 못 찾았다 — 스캔이 깨졌다')

  const allCards = INTEGRATION_CARDS.map(read).join('\n')

  // 화면이 직접 부르지 않아도, 화면이 부르는 다른 서버액션이 부르면 기능은 닿아 있다.
  // (공급자 키 창구 한 벌 — 카드 한 벌이 deleteProviderKey 를 공급자 id 로 부른다)
  // 그래서 「카드가 부르는가」가 아니라 「카드에서 출발해 닿는가」를 본다.
  // 부분 문자열 매칭 금지 — deleteXKey2 같은 이름이 deleteXKey를 포함해 가드가 통과해 버린다
  const bodies = new Map<string, string>()
  for (const part of actions.split('export async function ').slice(1)) {
    const name = part.match(/^(\w+)/)?.[1]
    if (name) bodies.set(name, part)
  }
  const reachable = new Set([...bodies.keys()].filter((n) => new RegExp(`\\b${n}\\b`).test(allCards)))
  for (let grew = true; grew; ) {
    grew = false
    for (const name of [...reachable]) {
      for (const callee of bodies.keys()) {
        if (reachable.has(callee) || callee === name) continue
        if (new RegExp(`\\b${callee}\\b`).test(bodies.get(name) ?? '')) {
          reachable.add(callee)
          grew = true
        }
      }
    }
  }
  const unwired = deleteFns.filter((fn) => !reachable.has(fn))
  assert.deepEqual(unwired, [],
    `서버액션은 있는데 UI가 호출하지 않는다(기능이 사라진 것처럼 보인다): ${unwired.join(', ')}`)
})

test('§2-5(3) 기능: 연결 테스트가 가능한 카드는 전부 제공한다', () => {
  // 키를 저장하는 카드는 저장이 실제로 통하는지 확인할 수단이 있어야 한다.
  // AI 공급자 카드는 한 벌이라 한 번만 적는다 — 다섯을 적던 시절의 목록이 아니다
  const needsTest = ['AiProviderCard.tsx',
    'YoutubeSettings.tsx', 'KoraeximSettings.tsx', 'DbSettings.tsx']
  const missing = needsTest.filter((f) => !/\bIntegrationTest\b/.test(read(f)))
  assert.deepEqual(missing, [], `연결 테스트가 빠진 카드: ${missing.join(', ')}`)
})

test('§2-5(5) 배치: 설정 화면은 배치를 공용 그릇에 맡긴다', () => {
  /*
    예전에는 이 자리가 「.settings-grid 를 쓰는가」를 물었다. 그때는 관리자 설정만
    자기 격자를 짰기 때문이다 — 그래서 설정 화면 넷 중 여기만 검색 칸이 없고
    카드 위에 섹션 제목이 한 겹 더 있었다(사용자 지적 2026-09-22).

    배치는 이제 화면이 정하지 않는다. 그릇(SettingsCards)이 검색 한 칸과 분류 탭과
    카드 쌓기를 함께 갖는다. 화면이 자기 격자를 다시 짜면 그 셋이 또 갈린다.
  */
  const page = read('page.tsx')
  assert.ok(page.includes('SettingsCards'),
    '설정 화면은 카드를 공용 그릇(SettingsCards)에 담는다')
  const own = ['settings-grid', 'settings-stack', 'settings-balance', 'gridTemplateColumns']
    .filter((name) => page.includes(name))
  assert.deepEqual(own, [],
    `설정 화면이 자기 배치를 짠다(그릇에 맡길 것): ${own.join(', ')}`)
})
