/**
 * 분석이 못 만든 절이 화면에서 「없음」으로 보이지 않게 한다 (실측 2026-09-22)
 *
 * ## 왜 생겼나
 *
 * 분석은 절 단위로 따로 돈다. 그래서 «다 됐다»와 «다 못 됐다» 사이에 **일부만 됐다**가 있다.
 * 케이스 e3338eb6 에서 일곱 작업 중 셋(예산·제출 서류·이상 조항)이 못 돌았다.
 * 잡은 `done` 으로 끝났고 사유는 `rfp_analysis_jobs.progress.failures` 에 정확히 남았다.
 *
 * 그런데 화면은 그 칸을 **안 읽었다.** 값이 0인 절은 안 그려지므로, 사용자는
 * 「이상 조항 없음」으로 읽었다. 없다고 말하는 것 자체가 판단인데 아무도 그 판단을 안 했다.
 *
 * ## 이 가드가 지키는 것
 *
 * 값이 가는 길을 **끝에서 끝까지** 잰다. 이름만 찾으면 안 된다 —
 * `select` 에서 칸 하나를 빼거나, 읽어 놓고 안 넘기거나, 넘겨 놓고 안 그려도
 * 화면은 똑같이 조용해진다. 이 저장소는 그 셋을 다 겪었다(→ 기억: 가드는 값이 가는지를 본다).
 *
 * 그리고 **밖에서 온 문구가 화면으로 새지 않는지**도 같이 본다. 사유를 말하려다
 * 공급자 오류 원문(조직 id·과금 주소가 들어 있다)을 그대로 싣는 것이 가장 쉬운 실수다.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const PAGE = 'app/(rfp)/rfp/[id]/page.tsx'
const CLIENT = 'app/(rfp)/rfp/[id]/ReportClient.tsx'

function read(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('잡을 읽을 때 progress 칸을 함께 가져온다 — 칸을 빼면 사유가 영영 안 온다', () => {
  const src = read(PAGE)
  const select = /from\('rfp_analysis_jobs'\)\s*[\r\n]*\s*\.select\(([^)]*)\)/.exec(src)
  assert.ok(select, 'rfp_analysis_jobs 를 읽는 자리를 못 찾았다')
  assert.match(select![1], /progress/, 'select 에 progress 가 없다 — 사유가 담긴 칸이다')
})

test('끝난 analyze 잡을 골라 그 사유를 화면으로 넘긴다', () => {
  const src = read(PAGE)
  // 잡이 실패한 것이 아니라 **끝났는데 절이 실패한** 경우를 골라야 한다
  assert.match(src, /job_type === 'analyze' && \w+\.status === 'done'/,
    '끝난 analyze 잡을 고르는 자리가 없다')
  assert.match(src, /missing:\s*missingSections\(/,
    'missingSections 의 결과를 missing 으로 넘기지 않는다')
})

test('화면이 그 값을 실제로 그린다 — 받아 놓고 안 쓰면 같은 침묵이다', () => {
  const src = read(CLIENT)
  assert.match(src, /progress\.missing/, '화면이 progress.missing 을 안 읽는다')
  assert.match(src, /missingBySection/, '절마다 사유를 붙이는 자리가 없다')
  // 배너와 절, 둘 다 있어야 한다. 배너만 있으면 어느 절인지 모르고,
  // 절만 있으면 값이 0이라 안 그려진 절을 영영 못 본다
  /*
    **부분 문자열로 재면 안 된다.** `missingSome` 은 `missingSomeDesc` 의 앞부분이라,
    제목을 딴 것으로 바꿔도 설명 줄 하나 때문에 이 단정이 통과한다 —
    실제로 그렇게 짰다가 일부러 깨뜨린 판이 초록으로 지나갔다(2026-09-22).
    화면으로 나가는 모양(`{...}`)까지 함께 본다.
  */
  assert.match(src, /RFP_REPORT\.missingSome\}/, '못 만든 절 배너 제목이 없다')
  assert.match(src, /RFP_REPORT\.missingSomeDesc\}/, '못 만든 절 배너 설명이 없다')
  assert.match(src, /RFP_REPORT\.missingOne\}/, '절 단위 표시가 없다')
  assert.match(src, /RFP_FAILURE_REASON\[/, '사유를 사람 말로 바꾸는 자리가 없다')
})

test('이상 조항이 0건일 때 못 본 경우를 가른다 — 「없음」으로 접으면 안 된다', () => {
  const src = read(CLIENT)
  assert.match(src, /anomalies\.length === 0 && missingBySection\.has\('anomalies'\)/,
    '이상 조항을 못 본 경우를 따로 그리지 않는다')
})

test('공급자 오류 원문이 화면으로 가는 길이 없다', () => {
  const page = read(PAGE)
  const client = read(CLIENT)
  // 죽은 잡도 접어서 보낸다 — 원문을 그대로 실어 보내던 길이 있었다
  assert.match(page, /deadJob:[\s\S]{0,200}classifyFailure\(/,
    'deadJob 의 사유가 classifyFailure 를 안 지난다')
  assert.doesNotMatch(page, /deadJob:[\s\S]{0,200}error:\s*dead\.error/,
    'deadJob 에 공급자 원문이 그대로 실린다')
  assert.doesNotMatch(client, /progress\.deadJob\.error/,
    '화면이 공급자 원문을 그대로 그린다')
})

test('사유를 접는 규칙은 한 곳에만 있다 — 화면이 오류 문구를 직접 읽지 않는다', () => {
  const client = read(CLIENT)
  // 화면이 스스로 문구를 뒤지기 시작하면 규칙이 두 벌이 되고 한쪽만 고쳐진다
  assert.doesNotMatch(client, /\.includes\('429'\)|no credits|rate.?limit/i,
    '화면이 공급자 오류 문구를 직접 판정한다')
})
