/**
 * 가드 — **기다리는 자리가 무엇을 하는지 말한다** (정책 B-7)
 *
 * 실측 2026-09-28: 「찾아보기」를 누르면 4~6초 동안 단추만 잠기고 화면에 아무 말이 없었다.
 * 스피너도 진행 문구도 없어서, 눌린 것인지 화면이 죽은 것인지 구별할 수 없었다.
 * AI 호출이라 더 걸리는 날도 있다 — 침묵이 길어질수록 사람은 고장으로 읽는다.
 *
 * 문턱과 경과 표기는 `lib/ui/wait-progress` 가 정한다. 이 시험은 그 규칙을 다시 적지 않고
 * **이 화면이 그 자리를 실제로 지나는지**만 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WAIT } from '../../terms/wait.ts'
import { waitProgress } from '../../ui/wait-progress.ts'
import { ASSISTANT_ASK, ASSISTANT_WHEN } from './assistant-labels.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const PANEL = join(HERE, '..', '..', '..', TRADING_APP_DIR, 'settings', 'AssistantPanel.tsx')

test('★ 두 가지 기다림에 각각 할 말이 있다', () => {
  assert.ok(WAIT.settingPropose, '바꿀 값을 찾는 동안 할 말이 없다')
  assert.ok(WAIT.settingApply, '값을 올리는 동안 할 말이 없다')
  assert.notEqual(WAIT.settingPropose, WAIT.settingApply,
    '찾는 것과 올리는 것은 다른 일이다 — 같은 말을 하면 어느 쪽인지 모른다')
  for (const line of [WAIT.settingPropose, WAIT.settingApply]) {
    // 예상 시간을 약속하지 않는다 — 상한이 길어 약속하면 거의 늘 어긴다
    assert.doesNotMatch(line, /\d+\s*초|\d+\s*분|금방|잠깐이면/, `걸릴 시간을 약속한다: ${line}`)
    assert.match(line, /있어요$/, '무엇을 하는 중인지로 안 끝난다')
  }
})

test('★ 화면이 그 자리를 실제로 지난다 — 단추만 잠그고 끝내지 않는다', () => {
  const src = readFileSync(PANEL, 'utf8')
  assert.ok(src.includes('waitProgress('), '기다림 SSOT 를 안 부른다')
  assert.ok(src.includes('<WaitProgress'), '부르기만 하고 화면에 안 그린다')
  assert.ok(src.includes('useElapsedMs('), '경과 시간을 안 재면 문구가 늘 첫 줄에 멈춘다')
  for (const key of ['WAIT.settingPropose', 'WAIT.settingApply']) {
    assert.ok(src.includes(key), `${key} 를 안 쓴다 — 둘 중 한 기다림이 여전히 말이 없다`)
  }
  // 화면이 자기 말을 지어내지 않는다 (용어집이 정한다)
  assert.doesNotMatch(src, /doing=["']|setDoing\(['"][가-힣]/, '화면 안에서 문구를 직접 적는다')
})

test('기다림이 끝나면 그 자리를 치운다', () => {
  const src = readFileSync(PANEL, 'utf8')
  // 시작은 두 곳, 끝도 두 곳이어야 한다 — 한 쪽만 있으면 안내가 안 사라진다
  const starts = (src.match(/setWaitFrom\(Date\.now\(\)\)/g) ?? []).length
  const ends = (src.match(/setWaitFrom\(null\)/g) ?? []).length
  assert.equal(starts, 2, '기다림을 시작하는 자리가 둘이 아니다')
  assert.equal(ends, starts, `시작 ${starts}곳 / 끝 ${ends}곳 — 안내가 안 사라지는 길이 있다`)
})

test('첫 순간은 「시작했어요」로 열고 오래 걸리면 달래는 말이 붙는다', () => {
  // 문턱 자체는 SSOT 가 정한다. 여기서는 그 규칙을 지나는지만 본다
  assert.equal(waitProgress(0, WAIT.settingPropose).message, waitProgress(100, WAIT.settingPropose).message)
  const long = waitProgress(60_000, WAIT.settingPropose)
  assert.equal(long.message, WAIT.settingPropose)
  assert.ok(long.reassure, '오래 걸리는데 달래는 말이 없다')
  assert.ok(long.elapsedLabel, '얼마나 지났는지 안 적는다')
})

test('약속은 여전히 흐리지 않는다', () => {
  assert.match(ASSISTANT_WHEN, /다음 거래일/, '언제부터 듣는지가 사라졌다')
  assert.equal(ASSISTANT_ASK, '찾아보기')
})
