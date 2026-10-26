/**
 * 회의 시작 입구 배선 (P0172)
 *
 * 사용자 지시 2026-10-26: 「녹음」 단추는 회의 시작과 똑같이 되어야 한다.
 * 회의와 회의노트를 만들고, 작업대를 메모 편집기로 열고, 녹음이 돌고 있어야 한다.
 *
 * 그 일은 시작 한 길(`lib/meeting/start-flow.ts`)과 그것을 엮는 훅(`lib/meeting/use-start-meeting.ts`)이 한다.
 * 입구가 만드는 함수를 직접 부르면 주소, 녹음 중 막기, 오프라인 녹음이 그 입구에서만 갈린다.
 * 예전에 녹음 입구 셋이 각자 다른 탭으로 열고 녹음은 한 번 더 눌러야 켜졌던 것이 그 결과다.
 *
 * 그래서 값으로 센다.
 * - 입구 파일 전부가 훅을 import 하고 start(...) 를 부른다
 * - 어느 입구도 beginRecording, startMeeting, startMeetingNote 를 직접 부르지 않는다
 * - 녹음 단추를 그리는 파일은 전부 이 목록에 있다 (새 녹음 단추가 한 길을 건너뛰지 못하게)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = fileURLToPath(new URL('../../', import.meta.url))

const ENTRIES = [
  'components/meeting/MeetingStartButton.tsx',
  'components/crm/MeetingIntakeBox.tsx',
  'components/ui/crm/MeetingPanel.tsx',
  'app/(crm)/crm/meetings/MeetingsClient.tsx',
  'components/calendar/CalendarContextMenu.tsx',
  'components/calendar/DayWorkbench.tsx',
] as const

/** 이미 회의 안에 있는 녹음 자리, 새 회의를 만들지 않으므로 한 길을 지나지 않는다 */
const IN_MEETING_RECORDERS = new Set([
  'components/meeting/RecordingPanel.tsx',
  'components/meeting/RecordingBar.tsx',
])

/** 주석을 걷는다. 주석에 남은 옛 호출이나 단추 이름이 판정을 흐리지 않게 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function read(rel: string): string {
  return readFileSync(join(WEB, rel), 'utf8')
}

const DIRECT_CALLS = [/\bbeginRecording\(/, /\bstartMeeting\(/, /\bstartMeetingNote\(/]

test('★ 입구 전부가 시작 훅을 import 하고 start(...) 를 부른다', () => {
  for (const f of ENTRIES) {
    const src = code(read(f))
    assert.match(src, /from '@\/lib\/meeting\/use-start-meeting'/, `${f}: 시작 훅을 import 하지 않는다`)
    assert.match(src, /useStartMeeting\(\)/, `${f}: import 만 하고 훅을 안 쓴다`)
    assert.match(src, /\bstart\(\{ entry: /, `${f}: start(...) 를 안 부른다`)
  }
})

test('★ 어느 입구도 만드는 함수를 직접 부르지 않는다', () => {
  for (const f of ENTRIES) {
    const src = code(read(f))
    for (const re of DIRECT_CALLS) {
      assert.ok(!re.test(src), `${f}: ${re.source.replace('\\b', '').replace('\\(', '(')} 를 직접 부른다, 시작 한 길(useStartMeeting)을 지나야 한다`)
    }
  }
})

test('★ 녹음 입구는 entry record 로 들어간다', () => {
  const button = code(read('components/meeting/MeetingStartButton.tsx'))
  assert.match(button, /start\(\{ entry: 'record', target \}\)/, 'MeetingStartButton 이 녹음 입구로 안 들어간다')

  const box = code(read('components/crm/MeetingIntakeBox.tsx'))
  assert.match(box, /record: \{ label: RECORD_START_LABEL/, '첫 화면 녹음 단추가 용어집 이름으로 안 선다')
  assert.match(box, /ENTRY_ORDER: Entry\[\] = \['record'/, '첫 화면 녹음 단추가 순서에서 빠졌다')
  assert.match(box, /start\(\{ entry: k \}\)/, '첫 화면 단추가 누른 입구를 그대로 안 넘긴다')
})

test('★ 딜·회사 미팅 패널은 녹음과 작성 둘 다 딜과 회사를 물려 시작한다', () => {
  const panel = code(read('components/ui/crm/MeetingPanel.tsx'))
  assert.match(panel, /start\(\{ entry: 'record', dealId, companyId \}\)/, '패널에 딜·회사를 물린 녹음 시작이 없다')
  assert.match(panel, /start\(\{ entry: 'write', dealId, companyId \}\)/, '패널의 미팅 기록이 딜·회사를 안 물린다')
  assert.match(panel, /RECORD_START_LABEL/, '녹음 단추 이름이 용어집에서 안 온다')
})

test('★ 캘린더 두 입구는 날짜를 넘긴다', () => {
  assert.match(code(read('components/calendar/CalendarContextMenu.tsx')), /start\(\{ entry: 'write', dateKey: r\.dateKey \}\)/)
  assert.match(code(read('components/calendar/DayWorkbench.tsx')), /start\(\{ entry: 'write', dateKey: date \}\)/)
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

test('★ 녹음 단추를 그리는 파일은 전부 입구 목록에 있다, 새 녹음 단추가 한 길을 건너뛰지 못한다', () => {
  const files = [join(WEB, 'components'), join(WEB, 'app')].flatMap((d) => walk(d))
  assert.ok(files.length > 100, `훑을 파일이 너무 적다(${files.length}), 규칙이 헛돈다`)
  const listed = new Set<string>(ENTRIES)
  const found: string[] = []
  const stray: string[] = []
  for (const file of files) {
    const rel = relative(WEB, file)
    const src = code(readFileSync(file, 'utf8'))
    if (!/RECORD_START_LABEL|['">]녹음 시작/.test(src)) continue
    found.push(rel)
    if (!listed.has(rel) && !IN_MEETING_RECORDERS.has(rel)) stray.push(rel)
  }
  assert.ok(found.length >= 3, `녹음 단추를 하나도 못 찾았다(${found.length}), 찾는 식이 헛돈다`)
  assert.deepEqual(stray, [], `시작 한 길 밖에서 녹음 단추를 그린다: ${stray.join(', ')}`)
})
