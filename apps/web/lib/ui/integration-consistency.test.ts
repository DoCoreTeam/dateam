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
const INTEGRATION_CARDS = [
  'GeminiSettings.tsx',
  'ClaudeSettings.tsx',
  'OpenAiSettings.tsx',
  'YoutubeSettings.tsx',
  'KoraeximSettings.tsx',
  'GoogleDriveSettings.tsx',
  'DbSettings.tsx',
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
  // 부분 문자열 매칭 금지 — deleteXKey2 같은 이름이 deleteXKey를 포함해 가드가 통과해 버린다
  const unwired = deleteFns.filter((fn) => !new RegExp(`\\b${fn}\\b`).test(allCards))
  assert.deepEqual(unwired, [],
    `서버액션은 있는데 UI가 호출하지 않는다(기능이 사라진 것처럼 보인다): ${unwired.join(', ')}`)
})

test('§2-5(3) 기능: 연결 테스트가 가능한 카드는 전부 제공한다', () => {
  // 키를 저장하는 카드는 저장이 실제로 통하는지 확인할 수단이 있어야 한다.
  const needsTest = ['GeminiSettings.tsx', 'ClaudeSettings.tsx', 'OpenAiSettings.tsx',
    'YoutubeSettings.tsx', 'KoraeximSettings.tsx', 'DbSettings.tsx']
  const missing = needsTest.filter((f) => !/\bIntegrationTest\b/.test(read(f)))
  assert.deepEqual(missing, [], `연결 테스트가 빠진 카드: ${missing.join(', ')}`)
})

test('§2-5(5) 배치: 설정 화면은 행 정렬 그리드(.settings-grid)를 쓴다', () => {
  const page = read('page.tsx')
  assert.ok(page.includes('settings-grid'), '카드 배치는 .settings-grid로 한다')
  // 열 균형(masonry)은 카드 시작점이 어긋나 보여 폐기했다 — 되살아나면 잡는다
  assert.ok(!page.includes('settings-balance'),
    '열 균형 배치는 카드 시작점이 어긋나 보인다. 행 정렬(.settings-grid)을 쓸 것')
})
