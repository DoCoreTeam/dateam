/**
 * 설정 화면이 바꿀 수 있으면 저장도 돼야 한다
 *
 * **왜**: 이상 조항 규칙 화면에 스위치가 있는데 저장 창구가 **없었다**(실측 2026-09-16).
 *   `setEnabled` 로 화면 상태만 바뀌고 `fetch` 는 0건, `app/api/rfp/rules` 도 없었다.
 *   사용자는 켠 줄 알고, 우리는 안 켜진 채로 돌고, 다음에 들어오면 꺼져 있다.
 *   그때 사용자는 자기가 잘못 눌렀다고 생각하고 다시 켠다.
 *
 *   「없는 기능」은 사용자가 기대를 안 한다. 「있는 척하는 기능」이 더 나쁘다.
 *
 * 검사 셋:
 *   1) 값을 바꿀 수 있는 설정 화면은 저장 요청을 보낸다
 *   2) 읽기 전용 화면은 등재로 면제하되 사유가 함께 적혀 있다
 *   3) 규칙이 도는 대상이 실제로 있다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 읽기만 하는 설정 화면. 사유를 함께 적는다.
 *
 * 사유 없이 목록에만 넣으면 이 목록이 **면제 서랍**이 된다.
 * 저장을 안 붙인 채로 이름만 여기 넣고 지나가는 길이 그렇게 생긴다.
 */
const READ_ONLY: Record<string, string> = {
  'components/rfp/TransferLog.tsx': '외부 전송 기록은 일어난 일이라 고칠 수 있는 것이 아니다',
  'components/rfp/UsageDashboard.tsx': '사용량은 센 값이라 화면에서 고치는 것이 아니다',
  'components/rfp/VendorSettings.tsx': '등급 편집은 아직 없다. 그래서 바꿀 수 있는 것을 안 그린다',
  'app/(rfp)/rfp/admin/NotificationSettings.tsx': '받을 알림을 고르는 자리가 아직 없다. 그래서 스위치를 안 그리고 화면이 그 사실을 말한다',
}

/**
 * 설정 페이지. **여기가 그리는 것이 설정 화면이다.**
 *
 * 폴더로 잡으면 같은 폴더의 위젯까지 딸려 온다(실제로 어시스턴트 독과 도움말 버튼과
 * 원문 뷰어를 잡았다 — 셋 다 여는 상태를 들고 있을 뿐 설정이 아니다).
 * 설정 페이지가 그리는 것만 보면 그 문제가 없고, 새 설정 화면을 붙이는 순간 자동으로 들어온다.
 */
const SETTINGS_PAGE = 'app/(rfp)/rfp/admin/page.tsx'

interface Screen { rel: string; src: string }

/** 설정 페이지가 import 하는 화면들 */
function settingsScreens(): Screen[] {
  const page = readFileSync(join(WEB, SETTINGS_PAGE), 'utf8')
  const specs = [...page.matchAll(/^import\s+(?:\w+|\{[^}]*\})\s*(?:,\s*\{[^}]*\})?\s*from\s+'([^']+)'/gm)]
    .map((m) => m[1])
    .filter((spec) => spec.startsWith('./') || spec.startsWith('@/components/rfp/'))

  const out: Screen[] = []
  for (const spec of specs) {
    const rel = spec.startsWith('./')
      ? `app/(rfp)/rfp/admin/${spec.slice(2)}.tsx`
      : `${spec.replace('@/', '')}.tsx`
    const full = join(WEB, rel)
    if (!existsSync(full)) continue
    out.push({ rel, src: readFileSync(full, 'utf8') })
  }
  return out
}

/** 사용자가 값을 바꿀 수 있는가. 체크박스나 입력이 상태를 고치면 그렇다 */
function canChange(src: string): boolean {
  return /onChange=|onClick=\{[^}]*set[A-Z]/.test(src) && /useState/.test(src)
}

/** 바꾼 것을 서버로 보내는가 */
function canSave(src: string): boolean {
  return /fetch\(|useFormState|action=\{/.test(src)
}

test('★ 바꿀 수 있는 설정 화면은 저장도 된다', () => {
  const offenders: string[] = []
  for (const s of settingsScreens()) {
    if (!canChange(s.src)) continue
    if (canSave(s.src)) continue
    if (s.rel in READ_ONLY) {
      offenders.push(`${s.rel} 은 읽기 전용으로 등재됐는데 실제로는 바꿀 수 있다`)
      continue
    }
    offenders.push(`${s.rel} 이 값을 바꾸는데 저장 요청이 없다`)
  }
  assert.deepEqual(offenders, [], [
    '설정이 저장되는 척한다. 사용자는 바꾼 줄 알고 다음에 들어오면 되돌아가 있다:',
    ...offenders.map((o) => `  ${o}`),
    '고치는 법: 저장 창구를 만들어 잇고, 실패하면 화면을 되돌린다',
  ].join('\n'))
})

test('★ 읽기 전용 면제는 사유와 함께 적는다', () => {
  const noReason = Object.entries(READ_ONLY)
    .filter(([, why]) => why.trim().length < 10)
    .map(([f]) => f)
  assert.deepEqual(noReason, [], [
    '사유 없이 면제된 화면이 있다. 사유를 안 적으면 이 목록이 면제 서랍이 된다:',
    ...noReason.map((f) => `  ${f}`),
  ].join('\n'))

  const gone = Object.keys(READ_ONLY).filter((f) => !existsSync(join(WEB, f)))
  assert.deepEqual(gone, [], `면제 목록에 없는 파일이 있다: ${gone.join(', ')}`)
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로가 깨져 0개가 되면 위 검사는 «위반 없음»으로 통과해 버린다
  const screens = settingsScreens()
  assert.ok(screens.length >= 4, `설정 페이지가 그리는 화면을 ${screens.length}개만 찾았다`)
  assert.ok(screens.some((s) => canChange(s.src)), '바꿀 수 있는 화면을 하나도 못 찾았다')
  assert.ok(screens.some((s) => canSave(s.src)), '저장하는 화면을 하나도 못 찾았다')
})
