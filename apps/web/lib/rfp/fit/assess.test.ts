/**
 * 적합도 판정 가드 (설계서 3.10.3)
 *
 * 여기서 잠그는 것 넷
 * - 하드 제약 결과가 셋(충족·미충족·확인불가)인가
 * - 가중치 40 25 15 -20 10 이 코드로 계산되고 같은 입력에 같은 값인가
 * - 판정 3분기와 조건부 꼬리표가 설계서와 같은가
 * - 프로필 버전과 리포트 버전이 결과에 남는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { emptyProfile, type CompanyProfile } from './profile.ts'
import { RFP_PROFILE } from '../terms.ts'

import {
  emptyProfile, classifyRequirement, parseAmount, parseCount, type CompanyProfile,
} from './profile.ts'
import {
  assess, checkHard, softScore, SOFT_WEIGHTS, FULL_SCORE_MIN, PARTIAL_SCORE_MIN,
  applyFitLayer, hardRequirementsFrom, softInputsFrom,
  type SoftInputs, type HardRequirement,
} from './assess.ts'

function 프로필(over: Partial<CompanyProfile> = {}): CompanyProfile {
  const p = emptyProfile(3)
  return {
    ...p,
    status: 'active',
    basic: {
      ...p.basic, companyName: '데이터얼라이언스', registrations: ['소프트웨어사업자 신고'],
      capitalKrw: 1_000_000_000, annualRevenueKrw: 5_000_000_000, headcount: 50, region: '서울특별시',
    },
    certifications: [{ name: 'ISO 27001', issuer: null, validUntil: null }],
    trackRecords: [
      { projectName: 'A', client: null, amountKrw: 2_000_000_000, startDate: null, endDate: null, domainTags: [] },
      { projectName: 'B', client: null, amountKrw: 500_000_000, startDate: null, endDate: null, domainTags: [] },
    ],
    capabilities: [{ tag: 'GPU 인프라', level: 5 }],
    partners: [{ name: '파트너사', capabilities: ['CSAP 인증', '데이터 구축'] }],
    ...over,
  }
}

const 요건 = (text: string): HardRequirement => ({ text, blockId: 'b1' })

const 좋은점수: SoftInputs = { capability: 0.9, trackRecord: 0.8, scale: 0.9, risk: 0.1, competition: 0.5 }
const 낮은점수: SoftInputs = { capability: 0.4, trackRecord: 0.3, scale: 0.4, risk: 0.5, competition: 0.3 }

// 요건 유형

test('요건 문장에서 유형을 알아낸다', () => {
  assert.equal(classifyRequirement('소프트웨어사업자 신고를 마친 업체'), 'business_registration')
  assert.equal(classifyRequirement('최근 3년 이내 유사 실적 3건 이상'), 'record_count')
  assert.equal(classifyRequirement('단일 계약금액 10억원 이상 실적 보유'), 'record_amount')
  assert.equal(classifyRequirement('자본금 5억원 이상'), 'capital')
  assert.equal(classifyRequirement('연간 매출 100억원 이상'), 'revenue')
  assert.equal(classifyRequirement('ISO 27001 인증 보유'), 'certification')
  assert.equal(classifyRequirement('본사 소재지가 관내인 업체'), 'region')
  assert.equal(classifyRequirement('특급 기술자 3명 이상'), 'personnel')
  assert.equal(classifyRequirement('그 밖에 발주기관이 인정하는 자'), 'unknown')
})

test('금액과 건수를 뽑는다', () => {
  assert.equal(parseAmount('자본금 5억원 이상'), 500_000_000)
  assert.equal(parseAmount('3,000만원 이상'), 30_000_000)
  assert.equal(parseAmount('자본금 요건 없음'), null)
  assert.equal(parseCount('실적 3건 이상'), 3)
  assert.equal(parseCount('실적 보유'), null)
})

// 하드 제약 3값

test('하드 제약 결과가 셋이다', () => {
  const p = 프로필()
  assert.equal(checkHard(요건('자본금 5억원 이상'), p).result, 'met')
  assert.equal(checkHard(요건('자본금 50억원 이상'), p).result, 'unmet')
  // 못 읽은 요건을 미충족으로 두면 멀쩡한 사업이 부적합으로 뜬다
  assert.equal(checkHard(요건('그 밖에 발주기관이 인정하는 자'), p).result, 'unknown')
})

test('값을 모르면 확인 불가다', () => {
  const p = 프로필({ basic: { ...프로필().basic, capitalKrw: null } })
  assert.equal(checkHard(요건('자본금 5억원 이상'), p).result, 'unknown')
})

test('무엇과 비교했는지 남긴다', () => {
  const c = checkHard(요건('자본금 5억원 이상'), 프로필())
  // 사용자가 「왜 미충족이냐」를 물을 자리다
  assert.match(c.profileBasis ?? '', /자본금 1,000,000,000원/)
})

test('실적과 인증은 파트너로 채울 수 있다', () => {
  const p = 프로필()
  assert.equal(checkHard(요건('유사 실적 5건 이상'), p).coverableByPartner, true)
  assert.equal(checkHard(요건('CSAP 인증 보유'), p).coverableByPartner, true)
  // 자본금은 파트너가 대신 못 갖는다
  assert.equal(checkHard(요건('자본금 50억원 이상'), p).coverableByPartner, false)
})

test('파트너가 없으면 채울 수 없다', () => {
  const p = 프로필({ partners: [] })
  assert.equal(checkHard(요건('유사 실적 5건 이상'), p).coverableByPartner, false)
})

// 소프트 점수

test('가중치가 설계서와 같다', () => {
  assert.deepEqual({ ...SOFT_WEIGHTS }, {
    capability: 40, trackRecord: 25, scale: 15, risk: -20, competition: 10,
  })
})

test('점수가 코드로 계산되고 같은 입력에 같다', () => {
  // 모델에게 물으면 같은 입력에 다른 답이 나온다
  const a = softScore(좋은점수)
  const b = softScore(좋은점수)
  assert.deepEqual(a, b)
  assert.equal(a.parts.capability, 36)
  assert.equal(a.parts.risk, -2)
  assert.equal(a.total, Math.round(36 + 20 + 13.5 - 2 + 5))
})

test('리스크가 점수를 깎는다', () => {
  const 낮은리스크 = softScore({ ...좋은점수, risk: 0 })
  const 높은리스크 = softScore({ ...좋은점수, risk: 1 })
  assert.equal(높은리스크.total, 낮은리스크.total - 20)
})

test('점수가 0~100 을 벗어나지 않는다', () => {
  assert.equal(softScore({ capability: 9, trackRecord: 9, scale: 9, risk: 0, competition: 9 }).total, 90)
  // 음수 점수는 화면에서 뜻을 잃는다
  assert.equal(softScore({ capability: 0, trackRecord: 0, scale: 0, risk: 1, competition: 0 }).total, 0)
  assert.equal(softScore({ capability: NaN, trackRecord: 0, scale: 0, risk: 0, competition: 0 }).total, 0)
})

// 판정 3분기

test('하드 전부 충족 + 70점 이상이면 전체 수행이다', () => {
  const r = assess({
    hardRequirements: [요건('자본금 5억원 이상'), 요건('ISO 27001 인증 보유')],
    profile: 프로필(), soft: 좋은점수, reportVersion: 2,
  })
  assert.equal(r.verdict, 'full')
  assert.ok(r.score >= FULL_SCORE_MIN)
  assert.equal(r.conditional, false)
})

test('하드는 다 되는데 점수가 모자라면 부분 참여다', () => {
  const r = assess({
    hardRequirements: [요건('자본금 5억원 이상')],
    profile: 프로필(), soft: 낮은점수, reportVersion: 1,
  })
  assert.equal(r.verdict, 'partial')
  assert.ok(r.score < FULL_SCORE_MIN)
  // 「부적합」만 보여 주면 사용자가 할 일이 없다
  assert.ok(r.gaps.some((g) => g.includes('전체 수행 기준')))
})

test('미충족을 파트너로 채울 수 있고 50점 이상이면 부분 참여다', () => {
  const r = assess({
    hardRequirements: [요건('유사 실적 5건 이상')],
    profile: 프로필(), soft: 좋은점수, reportVersion: 1,
  })
  assert.equal(r.verdict, 'partial')
  assert.ok(r.gaps.some((g) => g.includes('파트너 역량으로 채울 수 있다')))
})

test('직접 갖춰야 하는 요건이 미충족이면 부적합이다', () => {
  const r = assess({
    hardRequirements: [요건('자본금 50억원 이상')],
    profile: 프로필(), soft: 좋은점수, reportVersion: 1,
  })
  // 점수가 아무리 높아도 자격이 안 되면 못 낸다
  assert.equal(r.verdict, 'unfit')
  assert.ok(r.gaps.some((g) => g.includes('직접 갖춰야 한다')))
})

test('파트너로 채울 수 있어도 점수가 낮으면 부적합이다', () => {
  const r = assess({
    hardRequirements: [요건('유사 실적 5건 이상')],
    profile: 프로필(), soft: { capability: 0.1, trackRecord: 0.1, scale: 0.1, risk: 0.9, competition: 0.1 },
    reportVersion: 1,
  })
  assert.ok(r.score < PARTIAL_SCORE_MIN)
  assert.equal(r.verdict, 'unfit')
})

// 조건부 꼬리표

test('확인 불가 요건이 있으면 조건부다', () => {
  const r = assess({
    hardRequirements: [요건('자본금 5억원 이상'), 요건('그 밖에 발주기관이 인정하는 자')],
    profile: 프로필(), soft: 좋은점수, reportVersion: 1,
  })
  // 못 읽은 요건이 있으면 사람이 봐야 한다
  assert.equal(r.conditional, true)
  assert.equal(r.summary.unknown, 1)
  assert.equal(r.summary.met, 1)
})

test('요건별 결과 수를 센다', () => {
  const r = assess({
    hardRequirements: [
      요건('자본금 5억원 이상'),
      요건('자본금 50억원 이상'),
      요건('그 밖에 발주기관이 인정하는 자'),
    ],
    profile: 프로필(), soft: 좋은점수, reportVersion: 1,
  })
  assert.deepEqual(r.summary, { met: 1, unmet: 1, unknown: 1 })
  assert.equal(r.hardChecks.length, 3)
})

// 버전

test('프로필 버전과 리포트 버전이 결과에 남는다', () => {
  const r = assess({
    hardRequirements: [], profile: 프로필(), soft: 좋은점수, reportVersion: 7,
  })
  // 안 남기면 「그때는 왜 부적합이었지」에 영영 답할 수 없다
  assert.equal(r.profileVersion, 3)
  assert.equal(r.reportVersion, 7)
})

test('요건이 없으면 점수만으로 판정한다', () => {
  const r = assess({ hardRequirements: [], profile: 프로필(), soft: 좋은점수, reportVersion: 1 })
  assert.equal(r.verdict, 'full')
  assert.deepEqual(r.summary, { met: 0, unmet: 0, unknown: 0 })
})

// 배선 — 적합도가 분석 경로에서 실제로 나는가

const 빈프로필 = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  ...emptyProfile(1), ...over,
})

test('회사 정보가 없으면 판정을 지어내지 않는다', () => {
  const r = applyFitLayer({
    profile: null, usable: false, report: {}, anomalies: [], reportVersion: 1,
  })
  assert.equal(r.assessment, null, '프로필이 없는데 점수를 냈다')
  assert.equal(r.blocked, 'no_profile')
})

test('초안 프로필로는 판정하지 않는다', () => {
  // 자동으로 뽑은 값이 틀린 채 판정에 쓰이면 부적합의 이유가
  // 「우리 회사 정보가 틀려서」가 되고 사용자는 그것을 영영 모른다
  const r = applyFitLayer({
    profile: 빈프로필({ status: 'draft' }), usable: false,
    report: {}, anomalies: [], reportVersion: 1,
  })
  assert.equal(r.assessment, null)
  assert.equal(r.blocked, 'draft_profile')
})

test('못 한 자리에 넣으러 갈 곳이 함께 나온다', () => {
  // 「없습니다」로 끝나는 안내는 읽는 쪽의 일을 늘리기만 한다
  assert.ok(RFP_PROFILE.fitBlockedNoProfile)
  assert.ok(RFP_PROFILE.fitBlockedDesc)
  assert.ok(RFP_PROFILE.fitBlockedCta, '넣으러 가는 길이 없다')
  assert.notEqual(RFP_PROFILE.fitBlockedDesc, RFP_PROFILE.fitBlockedDraftDesc, '두 사유가 같은 말을 한다')
})

test('프로필이 있으면 모자란 자격이 갭으로 나온다', () => {
  const r = applyFitLayer({
    profile: 빈프로필({
      status: 'active',
      basic: { ...emptyProfile(1).basic, companyName: '데이터얼라이언스', capitalKrw: 100_000_000 },
    }),
    usable: true,
    report: { constraints: { eligibility: { value: '자본금 10억원 이상\nISMS 인증 보유' } } },
    anomalies: [], reportVersion: 3,
  })
  assert.ok(r.assessment, '프로필이 있는데 판정이 없다')
  assert.equal(r.blocked, null)
  assert.equal(r.assessment.reportVersion, 3, '어느 판을 보고 판정했는지 안 적혔다')
  assert.ok(r.assessment.hardChecks.length >= 2, '자격 요건 두 줄을 안 읽었다')
  assert.ok(r.assessment.gaps.length > 0, '자본금도 인증도 모자란데 채울 것이 없다고 한다')
})

test('제약 칸을 여섯 다 읽는다', () => {
  // 한 칸이라도 빠지면 그 요건은 판정에서 통째로 사라지고, 사라진 사실은 아무 데도 안 나온다
  const report = {
    constraints: {
      eligibility: { value: 'A' }, technical: { value: 'B' }, legal: { value: 'C' },
      security: { value: 'D' }, personnel: { value: 'E' }, subcontracting: { value: 'F' },
    },
  }
  assert.deepEqual(hardRequirementsFrom(report).map((r) => r.text), ['A', 'B', 'C', 'D', 'E', 'F'])
})

test('볼 데이터가 없는 약한 점수에 0 을 넣지 않는다', () => {
  // 0 은 「안 맞는다」는 주장이다. 근거 없이 그 주장을 하면 점수가 거짓으로 내려간다
  const soft = softInputsFrom({ report: {}, profile: 빈프로필(), anomalies: [] })
  assert.equal(soft.capability, 0.5, '볼 것이 없는데 역량을 0 으로 깎았다')
  assert.equal(soft.scale, 0.5)
  assert.equal(soft.competition, 0.5, '경쟁 환경은 아직 볼 데이터가 없다')
  assert.equal(soft.risk, 0, '이상 조항이 없으면 위험도 없다')
  assert.equal(soft.trackRecord, 0, '실적 없음은 관측된 사실이라 0 이 맞다')
})

test('이상 조항이 무거울수록 위험이 오른다', () => {
  const low = softInputsFrom({ report: {}, profile: 빈프로필(), anomalies: [{ severity: 'competition' }] })
  const high = softInputsFrom({ report: {}, profile: 빈프로필(), anomalies: [{ severity: 'blocking' }] })
  assert.ok(high.risk > low.risk, '막는 조항이 경쟁 조항보다 안 무겁다')
  assert.ok(high.risk <= 1 && low.risk >= 0, '위험도가 0~1 을 벗어났다')
})

test('분석 경로가 적합도 층을 실제로 부른다', () => {
  const src = stripComments(readFileSync(new URL('../analyze/run-analyze.ts', import.meta.url), 'utf8'))
  assert.equal((src.match(/\bapplyFitLayer\s*\(/g) ?? []).length, 1, '적합도 층을 부르는 자리가 하나가 아니다')
  assert.match(src, /report\.fit\s*=/, '판정을 리포트에 안 돌려놓는다')
  assert.match(src, /\bloadProfile\s*\(/, '회사 프로필을 안 읽는다 — 그러면 늘 no_profile 이 된다')
  assert.match(src, /\bisUsableForAssessment\s*\(/, '초안 프로필을 걸러 내지 않는다')
})

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}
