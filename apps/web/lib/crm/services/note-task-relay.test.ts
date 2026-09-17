// lib/crm/services/note-task-relay.test.ts — 회의에서 뽑은 할 일이 딜까지 가는 길 가드
//
// **왜 이 가드가 필요한가** (2026-09-17 실측):
//   · 회의노트 [할 일·일정 뽑기]가 만든 할 일 40건 → `daily_logs` 40, `crm_task` **0**
//   · NEXT 제안으로 만들어진 `crm_task` **0건** (그 경로는 한 번도 돈 적이 없다)
//   딜 상세의 할 일 패널은 `crm_task` 를 `dealId` 로 걸러 본다. 그래서 그 40건은
//   **딜 화면에 영원히 안 뜬다** — 실패한 것이 아니라 **길이 없던 것**이라
//   화면에서는 「할 일이 없는 딜」과 구분되지 않는다.
//   사용자 지적: *"할일들 뽑으면 딜에서도 관련 프로젝트와 관련된 할일이 보여야 하는데 안보이는것 같은데?"*
//
// 길은 셋이 이어져야 성립한다 — ①뽑기가 릴레이를 부른다 ②릴레이가 딜을 싣는다
// ③딜 상세가 그것을 그린다. 하나라도 끊기면 나머지 둘이 멀쩡해도 화면은 그대로 빈다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, stripComments } from '../../ui/component-scan.ts'

function code(file: string): string { return stripComments(read(file)) }

const EXTRACT_ACTION = 'app/(member)/meeting-notes/actions.ts'
const RELAY = 'lib/crm/services/note-task-relay.ts'
const SUGGESTION = 'lib/crm/services/suggestion.ts'
const DEAL_DETAIL = 'app/(crm)/crm/deals/[id]/DealDetail.tsx'

test('★ 뽑기가 릴레이를 실제로 부른다 — 만들어 놓고 안 부르면 딜은 그대로 빈다', () => {
  const src = code(EXTRACT_ACTION)
  assert.ok(src.includes('relayNoteTasksToCrm('), '뽑기 확정이 릴레이를 안 부른다')
  // 결과를 돌려줘야 화면이 「딜에도 세웠어요」 또는 「딜을 붙여 주세요」를 말할 수 있다
  assert.ok(src.includes('crmTasksCreated'), '딜에 몇 건 섰는지 안 돌려준다')
  assert.ok(src.includes('crmSkipped'), '안 간 이유를 안 돌려준다 — 조용한 0건이 된다')
})

test('★ 릴레이가 딜·회사를 실어 만든다 — 안 실으면 어느 상세에도 안 선다', () => {
  /*
    **만드는 자리만 본다.** 처음엔 파일 전체에서 `dealId: meeting.dealId` 를 찾았는데,
    마지막 `return` 줄이 같은 모양이라 **만들 때 딜을 빼도 가드가 통과했다**
    (일부러 깨서 확인하다 잡혔다 — 부분문자열 매칭이 위반을 통과시킨 전례가 이 저장소에 있다).
  */
  const src = code(RELAY)
  const at = src.indexOf('await createTask(')
  assert.ok(at > 0, '릴레이가 할 일을 만드는 자리가 사라졌다')
  const call = src.slice(at, src.indexOf('})', at))
  assert.ok(/dealId:\s*meeting\.dealId/.test(call), '딜을 안 싣는다')
  assert.ok(/companyId:\s*meeting\.companyId/.test(call), '회사를 안 싣는다')
  assert.ok(/sourceMeetingId:\s*meeting\.id/.test(call), '출처 미팅을 안 싣는다 — 멱등 열쇠가 사라진다')
})

test('★ 붙을 곳이 없으면 안 만든다 — 어디에도 안 서는 할 일은 목록만 어지럽힌다', () => {
  const src = code(RELAY)
  assert.ok(/if \(!meeting\.dealId && !meeting\.companyId\)/.test(src),
    '딜도 회사도 없는 회의에서 할 일을 만들고 있다')
  assert.ok(src.includes("'not-published'"), '안 올린 회의를 팀 할 일로 새게 하고 있다')
  assert.ok(src.includes("'no-access'"), 'CRM 멤버가 아닌 사람의 노트에서 팀 데이터를 만들고 있다')
})

test('★ 멱등 질의가 휴지통까지 본다 — 안 보면 지운 할 일이 다음 뽑기에 되살아난다', () => {
  // 워크스페이스 가드는 `deletedAt` 키가 없는 조회에 `deletedAt: null` 을 끼워 넣는다.
  // 그대로 두면 사용자가 딜에서 지운 할 일이 [뽑기] 두 번째에 다시 선다
  // (실측: 같은 질의가 기본 0건 · `deletedAt: undefined` 명시 1건).
  const src = code(RELAY)
  assert.ok(/sourceMeetingId: meeting\.id, deletedAt: undefined/.test(src),
    '멱등 질의가 휴지통을 못 본다')
})

test('★ 제안으로 만드는 할 일도 딜을 단다 — 안 달면 그 딜 화면에는 영영 안 뜬다', () => {
  const src = code(SUGGESTION)
  const at = src.indexOf('tx.crmTask.create')
  assert.ok(at > 0, '제안이 할 일을 만드는 자리가 사라졌다')
  const body = src.slice(at - 200, at + 400)
  assert.ok(/dealId:\s*anchor\.dealId/.test(body), '제안 할 일에 딜이 안 붙는다')
  assert.ok(/companyId:\s*anchor\.companyId/.test(body), '제안 할 일에 회사가 안 붙는다')
  // 제안은 미팅을 직접 안 가리킨다 — 실행 기록의 inputRef 가 유일한 끈이다
  assert.ok(/inputRef/.test(src), '제안에서 미팅으로 거슬러 가는 끈이 끊겼다')
})

test('★ 딜 상세가 그 할 일을 그린다 — 세 번째 고리가 빠지면 앞의 둘이 헛일이다', () => {
  const src = code(DEAL_DETAIL)
  assert.ok(/<TaskPanel scope=\{\{ dealId \}\}/.test(src), '딜 상세에 딜 범위 할 일 패널이 없다')
})
