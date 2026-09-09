/**
 * RFP 도메인 상수 가드 — 등급·단계·말이 갈라지는 것을 차단
 *
 * ## 왜 이 셋을 한 파일에서 보나
 *
 * 등급은 «어디까지 내보낼 수 있나», 단계는 «어디까지 왔나», 말은 «뭐라 부르나» 다.
 * 셋은 서로 다른 것이지만 **하나가 어긋나면 나머지 둘이 거짓말을 한다** —
 * 등급 표에 값을 더하고 말 표에 안 더하면 화면에 영문 키가 뜨고,
 * 단계를 더하고 전이표에 안 더하면 그 단계에서 케이스가 영원히 멈춘다.
 *
 * ## 가드를 일부러 깨서 확인했다
 *
 * 아래 세 검사는 각각 표에서 한 줄을 지워 실패를 확인한 뒤 되돌렸다.
 * 부분문자열 매칭으로 위반을 통과시킨 전례가 이 저장소에 있다(v0.7.438).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { walkFiles, read, stripComments } from '../../ui/component-scan.ts'
import {
  DOC_CLASS_ORDER, DOC_CLASS_POLICY, decideTransfer, maxDocClass, isDocClass,
  type DocClass,
} from './doc-class.ts'
import {
  STAGE_TRANSITIONS, STAGE_ORDER, canTransition, isStage, advance, markFailed,
  needsHuman, MAX_STAGE_ATTEMPTS, type Stage, type CaseProgress,
} from './status.ts'
import {
  DOC_CLASS_LABEL, DOC_CLASS_HINT, DOC_CLASS_EFFECT, STAGE_LABEL,
  FILE_ROLE_LABEL, VERIFICATION_LABEL, GROUNDING_LABEL, ANOMALY_GRADE_LABEL,
  ANOMALY_SEVERITY_LABEL, FIT_VERDICT_LABEL, REQUIREMENT_RESULT_LABEL,
  ANALYSIS_MODE_LABEL, AI_NOTICE, estimateLine,
} from '../terms.ts'

// ── 등급 ────────────────────────────────────────────────────

test('★ 문서 등급은 셋뿐이고 순서가 위험도 순이다 — 섞였을 때 이기는 쪽이 여기서 정해진다', () => {
  assert.deepEqual([...DOC_CLASS_ORDER], ['public', 'restricted', 'nda'])
  assert.equal(maxDocClass(['public', 'nda', 'restricted']), 'nda')
  assert.equal(maxDocClass(['public', 'restricted']), 'restricted')
})

test('★ 빈 목록은 가장 안전한 쪽으로 본다 — 모르면 막는다', () => {
  assert.equal(maxDocClass([]), 'nda')
})

test('설계서 3.13.1 정책 매트릭스가 표와 1:1 로 대응한다', () => {
  // 표를 고칠 때 설계서와 같이 고쳤는지 보는 자리다
  assert.deepEqual(DOC_CLASS_POLICY.public.externalVendor, 'allowed')
  assert.deepEqual(DOC_CLASS_POLICY.restricted.externalVendor, 'zero_retention_only')
  assert.deepEqual(DOC_CLASS_POLICY.nda.externalVendor, 'blocked_unless_approved')

  // 프롬프트 캐시는 공개 문서에서만 — ZDR 예외 때문이다(설계서 5장 7)
  assert.equal(DOC_CLASS_POLICY.public.promptCache, true)
  assert.equal(DOC_CLASS_POLICY.restricted.promptCache, false)
  assert.equal(DOC_CLASS_POLICY.nda.promptCache, false)

  // 보존 기간
  assert.equal(DOC_CLASS_POLICY.public.originRetentionDays, null)
  assert.equal(DOC_CLASS_POLICY.restricted.originRetentionDays, 90)
  assert.equal(DOC_CLASS_POLICY.nda.originRetentionDays, 30)

  // 마스킹은 세 등급 모두 필수
  for (const c of DOC_CLASS_ORDER) assert.equal(DOC_CLASS_POLICY[c].masking, true)
})

test('등급 값 검사가 경계에서 동작한다 — DB·요청 본문이 아무 문자열이나 준다', () => {
  assert.equal(isDocClass('public'), true)
  assert.equal(isDocClass('PUBLIC'), false)
  assert.equal(isDocClass(''), false)
  assert.equal(isDocClass(null), false)
})

const OPEN = { noTraining: true, retentionDays: 30, zeroRetention: false }
const ZDR = { noTraining: true, retentionDays: 0, zeroRetention: true }
const TRAINS = { noTraining: false, retentionDays: 0, zeroRetention: true }

test('★ 공개 문서는 승인 벤더면 나간다', () => {
  const d = decideTransfer({ docClass: 'public', allowedDocClasses: ['public'], retention: OPEN })
  assert.deepEqual(d, { allowed: true, internal: false })
})

test('★ 조건부 공개는 보존하는 벤더로 못 나간다 — 이 한 줄이 3.13.1 의 실체다', () => {
  const d = decideTransfer({
    docClass: 'restricted', allowedDocClasses: ['public', 'restricted'], retention: OPEN,
  })
  assert.deepEqual(d, { allowed: false, reason: 'retention_not_zero' })
})

test('조건부 공개도 ZDR 벤더면 나간다 — 과차단하면 기능이 없는 것과 같다', () => {
  const d = decideTransfer({
    docClass: 'restricted', allowedDocClasses: ['public', 'restricted'], retention: ZDR,
  })
  assert.deepEqual(d, { allowed: true, internal: false })
})

test('★ 학습에 쓰는 벤더는 등급과 무관하게 먼저 막힌다', () => {
  const d = decideTransfer({
    docClass: 'restricted', allowedDocClasses: ['restricted'], retention: TRAINS,
  })
  assert.deepEqual(d, { allowed: false, reason: 'training_not_excluded' })
})

test('★ NDA 는 ZDR 이어도 관리자 승인이 없으면 막힌다', () => {
  const d = decideTransfer({ docClass: 'nda', allowedDocClasses: ['nda'], retention: ZDR })
  assert.deepEqual(d, { allowed: false, reason: 'admin_approval_required' })
})

test('NDA 도 승인이 있으면 ZDR 벤더로는 나간다', () => {
  const d = decideTransfer({
    docClass: 'nda', allowedDocClasses: ['nda'], retention: ZDR, adminApproved: true,
  })
  assert.deepEqual(d, { allowed: true, internal: false })
})

test('★ 모델이 그 등급을 안 받겠다고 등록됐으면 다른 조건을 보기 전에 막힌다', () => {
  const d = decideTransfer({ docClass: 'nda', allowedDocClasses: ['public'], retention: ZDR })
  assert.deepEqual(d, { allowed: false, reason: 'model_not_allowed_for_class' })
})

test('★ 사내 서빙은 외부 전송이 아니다 — NDA 문서의 유일한 길이다(F10)', () => {
  const d = decideTransfer({
    docClass: 'nda', allowedDocClasses: [], retention: TRAINS, internal: true,
  })
  assert.deepEqual(d, { allowed: true, internal: true })
})

// ── 단계 ────────────────────────────────────────────────────

test('설계서 3.3.1 상태 기계가 전이표와 1:1 로 대응한다', () => {
  // 인입에서 리포트까지는 한 줄이다 — 갈래가 없다
  const line: Stage[] = [
    'uploaded', 'classified', 'parsing', 'parsed', 'structuring', 'structured',
    'indexing', 'indexed', 'analyzing', 'reported',
  ]
  for (let i = 0; i < line.length - 1; i += 1) {
    assert.ok(canTransition(line[i], line[i + 1]), `${line[i]} -> ${line[i + 1]} 이 막혀 있다`)
  }
  // 리포트 뒤에만 갈래가 셋이다
  assert.deepEqual([...STAGE_TRANSITIONS.reported].sort(),
    ['assessing', 'comparing', 'cross_verifying'])
  // 교차검증은 언제나 리포트로 돌아온다(새 버전)
  assert.deepEqual([...STAGE_TRANSITIONS.cross_verifying], ['reported'])
})

test('★ 표에 없는 이동은 던진다 — 조용히 건너뛰면 그 단계가 안 돈 채 결과가 나온다', () => {
  const p: CaseProgress = { stage: 'uploaded', failedAt: null, failedReason: null, attempts: 0 }
  assert.throws(() => advance(p, 'reported'), /허용되지 않은/)
})

test('모든 단계가 순서 배열에 정확히 한 번 나온다 — 빠지면 진행률이 그 칸을 못 그린다', () => {
  const keys = Object.keys(STAGE_TRANSITIONS) as Stage[]
  assert.equal(STAGE_ORDER.length, keys.length)
  assert.equal(new Set(STAGE_ORDER).size, STAGE_ORDER.length)
  for (const k of keys) assert.ok(STAGE_ORDER.includes(k), `${k} 가 순서 배열에 없다`)
})

test('단계 값 검사가 경계에서 동작한다', () => {
  assert.equal(isStage('parsing'), true)
  assert.equal(isStage('parse'), false)
  assert.equal(isStage(3), false)
})

test('★ 실패는 단계를 바꾸지 않는다 — 어디까지 갔다가 어디서 멈췄나가 한 행에서 읽힌다', () => {
  const p: CaseProgress = { stage: 'parsing', failedAt: null, failedReason: null, attempts: 0 }
  const f = markFailed(p, '배포용 문서')
  assert.equal(f.stage, 'parsing')
  assert.equal(f.failedAt, 'parsing')
  assert.equal(f.failedReason, '배포용 문서')
  assert.equal(f.attempts, 1)
})

test('재시도 상한을 넘으면 사람에게 넘긴다 — 같은 실패를 무한히 반복하지 않는다', () => {
  let p: CaseProgress = { stage: 'parsing', failedAt: null, failedReason: null, attempts: 0 }
  for (let i = 0; i < MAX_STAGE_ATTEMPTS; i += 1) p = markFailed(p, '일시 오류')
  assert.equal(needsHuman(p), true)
})

test('넘어가면 실패 표시가 지워진다 — 풀린 실패가 화면에 남으면 안 된다', () => {
  const failed = markFailed(
    { stage: 'parsing', failedAt: null, failedReason: null, attempts: 0 }, '일시 오류')
  const ok = advance(failed, 'parsed')
  assert.equal(ok.failedAt, null)
  assert.equal(ok.failedReason, null)
  assert.equal(ok.attempts, 0)
  assert.equal(needsHuman(ok), false)
})

// ── 말 ──────────────────────────────────────────────────────

test('★ 등급·단계·역할에 빠짐없이 이름이 있다 — 하나라도 빠지면 화면에 영문 키가 뜬다', () => {
  for (const c of DOC_CLASS_ORDER) {
    assert.ok(DOC_CLASS_LABEL[c], `${c} 이름 없음`)
    assert.ok(DOC_CLASS_HINT[c], `${c} 설명 없음`)
    assert.ok(DOC_CLASS_EFFECT[c], `${c} 결과 설명 없음`)
  }
  for (const s of Object.keys(STAGE_TRANSITIONS) as Stage[]) {
    assert.ok(STAGE_LABEL[s], `${s} 이름 없음`)
  }
})

test('말 표에 빈 문자열이 없다 — 빈 이름은 없느니만 못하다', () => {
  const tables = [
    DOC_CLASS_LABEL, DOC_CLASS_HINT, DOC_CLASS_EFFECT, STAGE_LABEL, FILE_ROLE_LABEL,
    VERIFICATION_LABEL, GROUNDING_LABEL, ANOMALY_GRADE_LABEL, ANOMALY_SEVERITY_LABEL,
    FIT_VERDICT_LABEL, REQUIREMENT_RESULT_LABEL, ANALYSIS_MODE_LABEL,
  ]
  for (const t of tables) {
    for (const [k, v] of Object.entries(t)) {
      assert.ok(v.trim().length > 0, `${k} 가 빈 이름이다`)
    }
  }
})

test('★ 파일 역할은 아홉이다 — RFP 는 파일 하나가 아니라 묶음이다(설계서 5장 2)', () => {
  assert.equal(Object.keys(FILE_ROLE_LABEL).length, 9)
})

test('★ AI 생성 고지 문구가 있다 — 리포트·어시스턴트·내보내기에 전부 붙는다', () => {
  assert.ok(AI_NOTICE.includes('AI'))
  assert.ok(AI_NOTICE.includes('검토'))
})

test('비용·시간 예측은 오차 범위를 함께 말한다(설계서 4장 7)', () => {
  const line = estimateLine(2100, 3)
  assert.ok(line.includes('2,100원'))
  assert.ok(line.includes('3분'))
  assert.ok(line.includes('±30%'))
})

test('말에 마침표를 찍지 않는다 — 설계서 6장 문체', () => {
  const all = [
    ...Object.values(DOC_CLASS_LABEL), ...Object.values(DOC_CLASS_HINT),
    ...Object.values(DOC_CLASS_EFFECT), ...Object.values(STAGE_LABEL),
    ...Object.values(FILE_ROLE_LABEL), ...Object.values(FIT_VERDICT_LABEL),
  ]
  for (const s of all) assert.ok(!s.endsWith('.'), `마침표로 끝난다: ${s}`)
})

// ── 화면이 말을 직접 짓지 않는다 ─────────────────────────────

const WEB = join(import.meta.dirname, '..', '..', '..')
const SCREEN_DIRS = [join(WEB, 'app', '(rfp)'), join(WEB, 'components', 'rfp')]

/** 사람에게 보이는 자리만 본다 — 주석과 변수명은 대상이 아니다 */
function userFacing(src: string): string[] {
  const s = stripComments(src)
  const out: string[] = []
  const lit = /'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g
  let m: RegExpExecArray | null
  while ((m = lit.exec(s)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  const jsx = />([^<>{}\n]*[가-힣][^<>{}\n]*)</g
  while ((m = jsx.exec(s)) !== null) out.push(m[1])
  return out
}

test('★ RFP 화면은 한글을 직접 적지 않는다 — lib/rfp/terms 에서 가져온다', () => {
  const bad: string[] = []
  for (const dir of SCREEN_DIRS) {
    if (!existsSync(dir)) continue
    for (const f of walkFiles(dir)) {
      if (f.endsWith('.test.ts') || f.endsWith('.test.tsx')) continue
      for (const s of userFacing(read(f))) {
        if (/[가-힣]/.test(s)) bad.push(`${f.slice(WEB.length + 1)}: ${s.slice(0, 40)}`)
      }
    }
  }
  assert.deepEqual(bad, [], `화면이 한글을 직접 적었다 — lib/rfp/terms 로 옮긴다:\n  ${bad.join('\n  ')}`)
})

test('가드가 헛돌지 않는다 — 말 표가 실재하고 비어 있지 않다', () => {
  // 화면이 아직 없어도 이 검사가 통과해 «가드가 있다»는 착각을 만들지 않게,
  // 말 표 자체가 비지 않았음을 함께 못 박는다.
  assert.ok(Object.keys(STAGE_LABEL).length >= 15)
  assert.ok(Object.keys(DOC_CLASS_LABEL).length === 3)
})
