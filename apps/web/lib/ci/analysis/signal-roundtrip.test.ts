import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseSignalCandidates, SIGNAL_CANDIDATE_MAX } from './signals.ts'
import { kstWallToIso } from '../../datetime/kst.ts'

/* ─────────────────────────────────────────────────────────────────────────
 * AI 응답 → DB 행 → 화면. 「AI가 답을 준 순간부터」의 왕복을 잇는다.
 *
 * 왜 이 가드가 따로 필요한가(E-6): AI 쪽 한도가 막혀 **성공 경로를 브라우저로
 * 밟을 수 없다.** 그래서 계산으로 밟되, 계산이 화면과 같다는 증거를 함께 박는다 —
 * 아래 ANCHOR 는 실제로 DB 에 넣고 화면에서 눈으로 확인한 값이다.
 * 이 다리가 끊기면 한도가 풀린 날 «AI 는 답했는데 화면은 빈» 상태가 된다.
 * ───────────────────────────────────────────────────────────────────────── */

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..', '..', '..')

/**
 * 실측 앵커 — 2026-09-01 `/ci/trends?tab=signals` 에서 눈으로 확인한 한 쌍.
 * 이 모양의 행을 넣었을 때 화면이 「제목 · 종류 · 출처 · 날짜 · 원문 보기」를 그렸다.
 */
const ANCHOR_ROW = {
  kind: 'news',
  title: '[E2E검증] 플랫폼 정책 변경 — 협찬 표기 의무화',
  url: 'https://example-e2e-c.test/news/3',
  source: '테스트뉴스',
  status: 'candidate',
  confidence: 0.9,
}

/** AI 가 실제로 돌려주는 모양(코드펜스 + 배열). 손으로 만든 «깨끗한» 입력만 쓰면 의미가 없다. */
const RAW_AI = '```json\n' + JSON.stringify([
  {
    kind: 'news',
    title: '플랫폼 정책 변경 — 협찬 표기 의무화',
    url: 'https://example-e2e-c.test/news/3',
    source: '테스트뉴스',
    occurredDate: '2026-08-31',
    reason: '창작자 수익 구조에 직접 영향',
    topicId: 'tp-1',
  },
  {
    kind: 'community',
    title: '커뮤니티에서 「AI 더빙 티 난다」 반응 확산',
    url: 'https://example-e2e-b.test/post/2',
    source: '테스트커뮤니티',
    reason: '제작 방식에 대한 반응',
  },
], null, 0) + '\n```'

const TOPICS = [{ id: 'tp-1', name: '플랫폼' }]

test('★ AI 응답을 파싱하면 DB 가 요구하는 칸이 전부 채워진다', () => {
  const out = parseSignalCandidates(RAW_AI, TOPICS)
  assert.ok(out.length >= 2, `후보가 안 나왔다: ${out.length}`)
  for (const c of out) {
    // insertCandidates 가 그대로 쓰는 칸들 — 하나라도 없으면 insert 가 조용히 실패한다
    assert.ok(c.kind && typeof c.kind === 'string', 'kind 없음')
    assert.ok(c.title && c.title.trim().length > 0, 'title 없음')
    assert.ok(c.url && /^https?:\/\//.test(c.url), 'url 이 주소가 아니다')
    assert.ok(c.dedupeKey && c.dedupeKey.length > 0, 'dedupeKey 없음 — 같은 글이 매번 다시 담긴다')
    assert.ok(typeof c.confidence === 'number' && c.confidence > 0 && c.confidence <= 1, 'confidence 범위 밖')
  }
})

test('★ 앵커: 실제로 화면에 떴던 행과 같은 모양이 나온다', () => {
  const c = parseSignalCandidates(RAW_AI, TOPICS)[0]
  assert.equal(c.kind, ANCHOR_ROW.kind)
  assert.equal(c.url, ANCHOR_ROW.url)
  assert.equal(c.source, ANCHOR_ROW.source)
  // 주제를 맞히면 신뢰도가 올라간다 — 앵커 행과 같은 0.9
  assert.equal(c.confidence, ANCHOR_ROW.confidence)
  assert.equal(c.topicId, 'tp-1')
})

test('★ 날짜는 KST 벽시계로 변환된다 — 여기서 틀리면 화면 날짜가 하루 밀린다', () => {
  const c = parseSignalCandidates(RAW_AI, TOPICS)[0]
  assert.equal(c.occurredDate, '2026-08-31')
  // insertCandidates 가 쓰는 그 변환. **오프셋 없는 naive 문자열이면 9시간 밀린다**(datetime 정책)
  const iso = kstWallToIso(c.occurredDate!, '00:00')
  assert.equal(iso, '2026-08-31T00:00:00+09:00')
  assert.match(iso, /\+09:00$/, 'KST 앵커가 없다 — timestamptz 가 UTC 로 읽어 하루가 밀린다')
  assert.equal(new Date(iso).toISOString(), '2026-08-30T15:00:00.000Z')
})

test('★ 모델이 `date` 로 답해도 날짜를 버리지 않는다 — 프롬프트와 다르게 답하는 일이 잦다', () => {
  const raw = JSON.stringify([{ kind: 'news', title: '제목', url: 'https://a.test/1', source: 'S', reason: 'r', date: '2026-08-30' }])
  assert.equal(parseSignalCandidates(raw, TOPICS)[0].occurredDate, '2026-08-30')
})

test('그래도 형식이 아니면 비운다 — 지어내지 않는다', () => {
  const raw = JSON.stringify([{ kind: 'news', title: '제목', url: 'https://a.test/2', source: 'S', reason: 'r', date: '작년쯤' }])
  assert.equal(parseSignalCandidates(raw, TOPICS)[0].occurredDate, null)
})

test('날짜를 모르면 비운다 — 지어내지 않는다', () => {
  const c = parseSignalCandidates(RAW_AI, TOPICS)[1]
  assert.equal(c.occurredDate, null)
})

test('화면이 읽는 evidence.reason 이 채워진다 — 「왜 이게 이슈인가」가 사라지면 고를 수 없다', () => {
  for (const c of parseSignalCandidates(RAW_AI, TOPICS)) {
    assert.ok(c.reason && c.reason.trim().length > 0, `reason 없음: ${c.title}`)
  }
})

test('가드: insert 가 파서의 칸 이름을 그대로 쓴다 — 이름이 갈리면 조용히 null 이 들어간다', () => {
  const src = readFileSync(join(appRoot, 'lib/ci/ai/signals-server.ts'), 'utf8')
  const at = src.indexOf('from(\'ci_signals\').insert(')
  assert.ok(at > 0, 'insert 를 찾지 못했다')
  const body = src.slice(at, at + 900)
  for (const f of ['c.kind', 'c.title', 'c.url', 'c.source', 'c.topicId', 'c.confidence', 'c.dedupeKey', 'c.reason']) {
    assert.ok(body.includes(f), `${f} 를 넣지 않는다`)
  }
  assert.match(body, /status:\s*'candidate'/, '사람 확인 없이 확정으로 넣으면 §5-3 위반이다')
  assert.match(body, /kstWallToIso/, '날짜를 KST 앵커 없이 넣으면 하루 밀린다')
})

test('가드: 화면 조회가 후보의 evidence·confidence 를 가져온다', () => {
  const src = readFileSync(join(appRoot, 'lib/ci/queries/trends.ts'), 'utf8')
  const at = src.indexOf('const SIGNAL_SELECT')
  const sel = src.slice(at, at + 300)
  for (const col of ['kind', 'title', 'url', 'source', 'occurred_at', 'confidence', 'evidence', 'collected_at']) {
    assert.ok(sel.includes(col), `화면이 ${col} 을 안 읽는다 — 넣어도 안 보인다`)
  }
})

test('한 번에 담는 수에 상한이 있다 — 확인 대기가 감당 못 하게 쌓이지 않게', () => {
  const many = JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
    kind: 'news', title: `제목 ${i}`, url: `https://ex${i}.test/a`, source: 'S', reason: 'r',
  })))
  assert.ok(parseSignalCandidates(many, TOPICS).length <= SIGNAL_CANDIDATE_MAX)
})
