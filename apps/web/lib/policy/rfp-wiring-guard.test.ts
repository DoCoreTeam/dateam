/**
 * RFP 배선 가드 — **만들어 둔 것이 실제로 불리는가**
 *
 * ## 왜 따로 있나
 *
 * 이 저장소의 RFP 쪽에는 다 만들어 놓고 **아무도 안 부르는 코드**가 여럿 있었다.
 * 단위 시험은 전부 초록이었다 — 시험이 직접 부르니까. 실측 2026-09-30:
 *
 *   `runAll`(이상 조항 규칙 엔진)  부르는 곳 = 자기 시험 하나
 *   `assess`(적합도 판정 엔진)     부르는 곳 = 자기 시험 하나
 *   `usageDelta`(사용량)           주석에 「워커가 부른다」, 부르는 곳 = 0
 *   `rfp_audit_logs`               표·정책 있음, 쓰는 곳 = 0 (0행)
 *   `rfp_analysis_runs`            읽기만 함, 쓰는 곳 = 0 (0행)
 *   `rfp_usage_ledger`             쓰는 곳 = 0 (0행)
 *
 * 항목별 가드는 각자 자기 자리만 본다. 여기서는 **그 자리들이 한꺼번에 살아 있는지**를
 * 한 장으로 센다. 새 배선을 끊으면 여기가 먼저 빨개진다.
 *
 * ## 이름이 아니라 값이 가는지를 본다
 *
 * 주석과 import 줄을 지우고 센다. 이름만 찾으면 배선을 주석 처리해도,
 * import 만 남겨도 통과한다 — 이 플랜에서 실제로 두 번 그렇게 새어 나갔다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripComments } from '../ui/component-scan.ts'

const WEB = new URL('../../', import.meta.url)
const ROOT = new URL('../../../../', import.meta.url)

function read(rel: string, base: URL = WEB): string {
  return readFileSync(new URL(rel, base), 'utf8')
}

/** 주석과 import 줄을 지운다. 남는 것은 실제로 도는 코드다 */
function live(rel: string, base: URL = WEB): string {
  return read(rel, base)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/^[ \t]*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
}

const count = (src: string, re: RegExp): number => (src.match(re) ?? []).length

// 1. 엔진 둘이 분석 경로에서 불린다

test('이상 조항 규칙 엔진이 분석 경로에서 돈다', () => {
  const merge = live('lib/rfp/anomaly/merge.ts')
  assert.equal(count(merge, /\brunAll\s*\(/g), 1, '규칙 실행기를 부르는 자리가 하나가 아니다')

  const analyze = live('lib/rfp/analyze/run-analyze.ts')
  assert.equal(count(analyze, /\bapplyRuleLayer\s*\(/g), 1, '분석 경로가 규칙 층을 안 부른다')
  assert.match(analyze, /report\.anomalies\s*=\s*await\s+applyRuleLayer\s*\(|report\.anomalies\s*=\s*applyRuleLayer\s*\(/, '합친 결과가 규칙 층에서 안 온다')
  // 기본값만 쓰면 관리자가 고친 규칙이 안 먹는다
  assert.match(analyze, /applyRuleLayer\s*\(\s*\n?\s*mergeRules\s*\(/, 'DB 규칙을 안 합쳐서 넘긴다')
})

test('적합도 판정 엔진이 분석 경로에서 돈다', () => {
  const assess = live('lib/rfp/fit/assess.ts')
  assert.equal(count(assess, /\bassess\s*\(\s*\{/g), 1, '판정기를 부르는 자리가 하나가 아니다')

  const analyze = live('lib/rfp/analyze/run-analyze.ts')
  assert.equal(count(analyze, /\bapplyFitLayer\s*\(/g), 1, '분석 경로가 적합도 층을 안 부른다')
  // 이름만 보면 `report.fit = null && await withFitLayer(...)` 같은 판을 통과시킨다.
  // 값이 **그 함수에서 오는지**를 본다
  assert.match(analyze, /report\.fit\s*=\s*await\s+withFitLayer\s*\(/, '판정이 적합도 층에서 안 온다')
  assert.match(analyze, /\bloadProfile\s*\(/, '회사 프로필을 안 읽으면 늘 no_profile 이 된다')
  assert.match(analyze, /\bisUsableForAssessment\s*\(/, '초안 프로필을 안 거른다')
})

// 2. 원장 셋에 실제로 쌓는다

test('세 원장에 쌓는 자리가 살아 있다', () => {
  // 표와 정책은 있는데 쓰는 곳이 0이던 셋이다. 화면에서는 아무 일도 안 일어난 것처럼 보였다
  const ledgers = [
    { 이름: '사용량 원장', 파일: 'app/api/rfp/worker/tick/route.ts', 부름: /\brecordUsage\s*\(/g },
    { 이름: '감사 로그(사람이 만들 때)', 파일: 'app/api/rfp/cases/route.ts', 부름: /\brecordAudit\s*\(/g },
    { 이름: '감사 로그(레이더로 담을 때)', 파일: 'lib/rfp/intake/adopt-ports.ts', 부름: /\brecordAudit\s*\(/g },
    { 이름: '실행 이력', 파일: 'lib/rfp/analyze/run-analyze.ts', 부름: /\brecordAnalysisRun\s*\(/g },
  ]
  for (const l of ledgers) {
    assert.equal(count(live(l.파일), l.부름), 1, `${l.이름} 에 쌓는 자리가 하나가 아니다`)
  }
})

test('실행 이력 id 가 리포트에 실린다', () => {
  const analyze = live('lib/rfp/analyze/run-analyze.ts')
  // 고정값 null 을 넘기면 시험은 통과하는데 run_id 는 영영 비어 있다
  assert.doesNotMatch(analyze, /runId:\s*null/, 'runId 를 고정값 null 로 넘긴다')
  assert.match(analyze, /runId,/, '적은 이력 id 를 리포트에 안 싣는다')
})

test('기록 실패가 본 작업을 막지 않는다', () => {
  // 기록이 본 작업을 막으면 사용자는 「만들기가 안 된다」를 겪고 우리는 이유를 모른다
  const gateway = live('lib/rfp/ai/gateway.ts')
  assert.match(gateway, /try\s*\{[\s\S]*?deps\.recordUsage[\s\S]*?\}\s*catch/, '원장 기록 실패가 호출 결과를 죽인다')
  for (const f of ['lib/rfp/db/audit.ts', 'lib/rfp/tenant/usage.ts']) {
    const src = live(f)
    assert.match(src, /catch\s*\(?\w*\)?\s*\{/, `${f} 가 실패를 안 잡는다`)
    assert.match(src, /ok:\s*false/, `${f} 가 사유를 안 돌려준다`)
  }
})

// 3. 여러 행을 넣고 한 건만 기대하지 않는다

test('여러 행 insert 뒤 single() 을 부르는 자리가 없다', () => {
  /*
    PostgREST 는 한 행을 달라고 했는데 여러 행이 나오면 거절하면서 **넣던 것까지 되돌린다.**
    그 오류(PGRST116)를 실패가 아니라고 걸러 내면 아무도 모른 채 0행이 쌓인다 —
    실측 2026-09-30: 리포트 판 5개에 근거 필드 0행.
  */
  const files = [
    'lib/rfp/analyze/persist.ts',
    'lib/rfp/db/audit.ts',
    'lib/rfp/tenant/usage.ts',
  ]
  for (const f of files) {
    const src = live(f)
    /*
      사슬을 손으로 자르려 하면 insert 인자의 객체 리터럴 안 중괄호에 걸려 엉뚱한 데서 끊긴다
      (처음 쓴 판이 그래서 single() 을 되붙여도 통과했다).
      그래서 「배열을 넣고 → select 하고 → single()」을 한 정규식으로 잡되,
      그 사이에 다른 `.from(` 이 끼면 다른 사슬이므로 안 센다 — 안 막으면 뒤쪽의
      **멀쩡한 한 줄 insert** 의 single() 을 보고 빨개진다(실제로 그랬다)
    */
    assert.doesNotMatch(
      src,
      /\.insert\(\s*\w+\.map\((?:(?!\.from\()[\s\S])*?\.select\([^)]*\)\s*\.single\(\)/,
      `${f} 가 여러 행을 넣고 한 건만 기대한다`,
    )
    // PGRST116 을 「실패가 아님」으로 걸러 내는 코드가 남아 있으면 안 된다
    assert.doesNotMatch(src, /PGRST116/, `${f} 가 여러 행 오류를 삼킨다`)
  }
})

// 4. 키가 없다고 말하는 화면이 넣는 곳으로 보낸다

test('키가 없다고 말하는 화면 넷이 모두 넣는 곳으로 보낸다', () => {
  const surfaces = [
    { 이름: '포털 연동 카드', 파일: 'app/(rfp)/rfp/admin/G2bServices.tsx' },
    { 이름: '레이더 훑기 안내', 파일: 'components/rfp/RadarRules.tsx' },
    { 이름: '수집처 카드', 파일: 'components/rfp/SourceSites.tsx' },
    { 이름: '공급자 카드', 파일: 'components/rfp/VendorSettings.tsx' },
  ]
  for (const s of surfaces) {
    const src = live(s.파일)
    // 이름이 있는 것으로는 모자란다. 그 값이 href 로 가는지를 본다
    assert.match(src, /href=\{HOST_AI_SETTINGS_HREF\}|href:\s*HOST_AI_SETTINGS_HREF/, `${s.이름} 에 넣으러 가는 길이 없다`)
    assert.doesNotMatch(src, /href=["']\/admin\/settings["']/, `${s.이름} 가 주소를 손으로 적었다`)
  }
})

// 5. 크론 경로가 실제 라우트와 맞는다

test('vercel.json 의 RFP 일정이 실제 라우트를 가리킨다', () => {
  const vercel = JSON.parse(read('vercel.json')) as { crons: { path: string; schedule: string }[] }
  const rfp = vercel.crons.filter((c) => c.path.startsWith('/api/rfp/'))
  assert.ok(rfp.length >= 2, `RFP 일정이 ${rfp.length}개다 — 워커와 레이더 둘이 있어야 한다`)

  for (const c of rfp) {
    // 경로가 라우트와 안 맞으면 크론이 404 를 두드리고 아무도 모른다
    assert.ok(read(`app${c.path}/route.ts`).length > 0, `${c.path} 에 라우트 파일이 없다`)
    // Vercel 크론은 GET 으로 온다. GET 이 없으면 매번 405 다
    const src = live(`app${c.path}/route.ts`)
    assert.match(src, /export async function GET/, `${c.path} 에 GET 이 없다`)
    assert.match(src, /isMachineCall\s*\(/, `${c.path} 가 기계 호출을 안 가린다`)
  }
})

// 6. 되살리기 스크립트가 등재돼 있다

test('지난 판을 되살리는 스크립트가 등재돼 있다', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
  assert.ok(pkg.scripts['rfp:backfill-fields'], '되살리기 스크립트가 등재 안 됐다')
  assert.ok(read('scripts/rfp-backfill-fields.ts').length > 0)
  // 뽑는 규칙을 또 적으면 두 벌이 갈라지고, 갈라진 사실은 화면에서야 드러난다
  assert.match(live('scripts/rfp-backfill-fields.ts'), /toFieldRows\s*\(/, '되살리기가 기존 함수를 안 쓴다')
})

// 7. 이 플랜이 더한 시험이 실제로 돈다

test('이 플랜이 더한 시험 파일이 전부 등재돼 있다', () => {
  // 등재 안 된 시험은 안 도는 시험이고, 실패 0과 화면에서 똑같이 보인다
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
  const registered = pkg.scripts.test
  for (const f of [
    'lib/rfp/analyze/persist.test.ts',
    'lib/rfp/anomaly/anomaly.test.ts',
    'lib/rfp/anomaly/rules-row.test.ts',
    'lib/rfp/fit/assess.test.ts',
    'lib/rfp/tenant/tenant.test.ts',
    'lib/rfp/db/audit.test.ts',
    'lib/rfp/radar/hit-notice.test.ts',
    'lib/rfp/radar/key-link.test.ts',
    'lib/rfp/g2b/g2b.test.ts',
    'lib/rfp/g2b/services.test.ts',
    'lib/policy/rfp-wiring-guard.test.ts',
  ]) {
    assert.ok(registered.includes(`"${f}"`), `${f} 가 pnpm test 에 등재 안 됐다 — 안 도는 시험이다`)
  }
})

// 8. 마이그레이션이 표를 만들면 RLS 를 같은 판에서 켠다

test('이 플랜의 마이그레이션이 표를 열어 두지 않는다', () => {
  for (const f of [
    '296_rfp_anomaly_rule_seed.sql',
    '297_rfp_usage_ledger_write.sql',
    '299_rfp_g2b_service_state.sql',
    '300_rfp_anomaly_rule_org_key.sql',
  ]) {
    const sql = read(`supabase/migrations/${f}`, ROOT).replace(/^\s*--.*$/gm, '')
    // 사본은 원본의 RLS 를 안 물려받는다. 이 저장소는 그렇게 생긴 열린 사본을 다섯 개 겪었다
    assert.doesNotMatch(sql, /create table[\s\S]*?\bas\s+select/i, `${f} 가 사본을 뜬다`)
    if (/create table/i.test(sql)) {
      assert.match(sql, /enable row level security/i, `${f} 가 표를 만들고 RLS 를 안 켠다`)
    }
    // 정책 대상에 public 을 쓰지 않는다
    assert.doesNotMatch(sql, /for\s+(select|all|insert|update|delete)\s+to\s+public/i, `${f} 의 정책 대상이 public 이다`)
  }
})

// ─────────────────────────────────────────────────────────────
// 공고 레이더 — 사용자가 「무엇을 할지 고르는」 경로가 끊기지 않았나
// ─────────────────────────────────────────────────────────────

/*
  이 화면의 일은 **50건 중 뭘 할지 고르는 것**이다. 그러려면 셋이 다 있어야 한다:
  본다 → 판단한다 → 남기거나 숨긴다.

  사용자 지적 2026-10-01: *"공고를 누르면 상세가 나와야 하는거 아냐?"*,
  *"더보기로 더 수집 가능하게 해야 할거 아냐"*.
  숨기기만 만들고 그 앞의 「본다」를 확인도 안 한 결과였다.
*/

test('공고 원문으로 가는 길이 살아 있다', () => {
  // 케이스를 만들어야만 원문을 볼 수 있으면 판단하려고 먼저 분석 비용을 치르는 셈이 된다
  const url = live('lib/rfp/radar/notice-url.ts')
  // 열에 아홉이 bidNtceUrl 로 온다. 하나만 읽으면 한 길에서 들어온 공고가 통째로 링크를 잃는다
  assert.match(url, /'bidNtceUrl'/, '나라장터 주소 칸을 안 읽는다')
  assert.match(url, /'url'/, '기관 사이트 주소 칸을 안 읽는다')
  // 밖에서 온 값이 href 가 된다. javascript: 가 들어가면 그 자리가 실행 통로다
  assert.match(url, /SAFE_PROTOCOLS/, '규약을 안 가린다')

  const ui = live('components/rfp/RadarRules.tsx')
  assert.match(ui, /href=\{h\.notice\.url\}/, '목록이 원문으로 안 보낸다')
  assert.match(ui, /rel=\{EXTERNAL_LINK_PROPS\.rel\}/, '바깥 링크에 rel 이 없다')
  assert.doesNotMatch(ui, /rel="noopener"/, '링크 속성을 손으로 적었다')

  const detail = live('app/(rfp)/rfp/[id]/page.tsx')
  assert.match(detail, /noticeUrlOf\(/, '케이스 상세가 주소 함수를 안 쓴다')
  assert.doesNotMatch(detail, /raw\.url\b/, '케이스 상세가 한 칸만 읽는다')
})

test('판단에 필요한 것이 목록에 실린다', () => {
  // 표에 537건씩 차 있는데 화면이 네 칸만 보여 주고 있었다
  const cols = live('lib/rfp/radar/hit-notice.ts')
  for (const c of ['demand_agency', 'estimated_price', 'bid_open_at', 'contract_method', 'award_method', 'is_urgent']) {
    assert.ok(cols.includes(`'${c}'`), `${c} 를 안 읽는다`)
  }
  const ui = live('components/rfp/RadarRules.tsx')
  assert.match(ui, /noticeFacts\(/, '사실 줄을 한곳에서 안 만든다')
})

test('찾은 것을 끝까지 볼 수 있다', () => {
  // 적중 80건인데 50건만 보이고 30건은 어디에도 없었다. 배지도 50 이라고 떴다
  const route = live('app/api/rfp/radar/route.ts')
  assert.match(route, /slicePage\(/, '쪽을 안 나눈다')
  assert.doesNotMatch(route, /\.limit\(50\)/, '고정 상한이 남아 있다')
  assert.match(route, /const total = sorted\.length/, '좁힌 뒤의 공고 수를 안 센다')

  const ui = live('components/rfp/RadarRules.tsx')
  assert.match(ui, /RFP_RADAR\.hitMore/, '더보기가 없다')
  assert.match(ui, /hasMore\(/, '끝에 닿아도 더보기가 남는다')
  assert.match(ui, /RFP_RADAR\.hitShown\(hits\.length, total\)/, '배지가 가져온 수를 센다')
})

test('같은 공고가 한 줄로 뜨고 숨기기가 전부에 걸린다', () => {
  // 하나만 숨기면 나머지가 남아 다음 쪽에서 다시 나온다
  const route = live('app/api/rfp/radar/route.ts')
  const g = route.indexOf('groupHits('), s = route.indexOf('slicePage(')
  assert.ok(g > 0 && s > g, '자른 다음에 묶는다')

  const ui = live('components/rfp/RadarRules.tsx')
  const all = (ui.match(/ids: row\.ids \?\? \[row\.id\]/g) ?? []).length
  assert.equal(all, 2, `적중 전부에 거는 자리가 ${all}곳이다 — 숨기기와 보이기 둘이어야 한다`)
})

test('좁혀 보기가 밖에서 온 값을 안 믿는다', () => {
  const page = live('lib/rfp/radar/hit-page.ts')
  /*
    거르기는 SQL 이 아니라 여기서 한다. `like` 로 넘기면 「%」 한 글자가 모든 공고에 걸려
    거르려다 오히려 전부를 받는다. `includes` 에는 그 뜻이 없다 —
    이스케이프할 것이 없는 쪽을 고른 것이지 빠뜨린 것이 아니다
  */
  assert.match(page, /\.includes\(needle\)/, '글자 그대로 찾지 않는다')
  assert.doesNotMatch(page, /\.(i?like)\(/, 'SQL like 로 넘긴다 — 특수문자를 거르거나 여기서 걸러야 한다')
  assert.match(page, /MAX_QUERY/, '검색어 길이에 상한이 없다')
  assert.match(page, /MAX_PAGE_SIZE/, '한 쪽 크기에 상한이 없다')

  const route = live('app/api/rfp/radar/route.ts')
  const a = route.indexOf('attachNotices('), f = route.indexOf('matchesQuery(')
  assert.ok(a > 0 && f > a, '공고를 붙이기 전에 거른다 — 찾을 글자가 어디에도 없다')
})

test('수집이 옛 공고도 본다', () => {
  // 최근 500건만 읽으면 그 밖의 공고는 새 규칙에 영영 안 걸린다
  const route = live('app/api/rfp/radar/route.ts')
  assert.match(route, /sweepRanges\(/, '수집 범위를 안 나눈다')
  assert.doesNotMatch(route, /from\('rfp_sources'\)[\s\S]{0,300}?\.limit\(500\)/, '최근 500건만 읽는다')
  assert.match(route, /sweepTruncated\(/, '다 못 본 것을 안 말한다')
})

test('이 화면의 말이 전부 용어집에서 온다', () => {
  /*
    사용자 지적 2026-10-01: *"워딩과 키워드가 다 용어집을 따르지 않고 그냥 생각나는대로 만들어내네"*
    기능 파일에서 지어내면 같은 뜻에 두 말이 생기고, 사용자는 둘을 다른 일로 읽는다.
  */
  const terms = readFileSync(new URL('lib/rfp/terms.ts', WEB), 'utf8')
  assert.match(terms, /from '\.\.\/terms\/action\.ts'/, 'RFP 문구가 용어집을 안 물고 있다')
  // 이 화면이 쓰는 동작 말은 지어내지 않고 ACTION 에서 가져온다
  // 값이 실제로 그 상수에서 오는지를 본다. 이름이 파일 어딘가에 있는 것으로는 모자라다
  assert.match(terms, /hitDismiss:\s*ACTION\.hide/, '숨기기를 지어냈다')
  assert.match(terms, /hitRestore:\s*ACTION\.unhide/, '보이기를 지어냈다')
  assert.match(terms, /hitSelected:\s*ACTION\.select/, '선택을 지어냈다')
  assert.match(terms, /hitDismissing:\s*progress\(/, '진행 표기를 손으로 적었다')
  /*
    진행 표기와 금지어는 **lib/terms/terms.test.ts 와 lib/ui/glossary.test.ts 가 센다.**
    여기서 또 세면 두 가드가 서로 다른 지식을 들게 되고(상태인지 진행인지의 분류 같은 것),
    둘이 어긋나는 날 어느 쪽이 맞는지 아무도 모른다.
  */
})
