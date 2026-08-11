// lib/ci/settings/registry.ts — 설정 키 레지스트리 (Zod 스키마 SSOT)
// 설계서 §10.2: "키별 Zod 스키마 레지스트리로 타입과 범위 검증, 설정 UI 폼은 스키마에서 자동 생성
//               (신규 설정 추가 시 화면 코드 수정 없음)"
//
// 여기에 키를 추가하면 검증·기본값·UI 폼이 함께 따라온다. 미등록 키는 저장 자체가 거부된다.

import { z } from 'zod'
import type { CiSettingScope } from '../types.ts'

export type CiSettingGroup =
  | 'account' | 'workspace' | 'alert' | 'data' | 'topic'
  | 'analysis' | 'ai' | 'publish' | 'system'

export interface CiSettingDef<T = unknown> {
  key: string
  scope: CiSettingScope
  group: CiSettingGroup
  label: string
  /** 항목 아래 한 줄 설명 (설계서 §10.4) */
  help: string
  schema: z.ZodType<T>
  /** 안전한 기본값 — 설정을 하나도 건드리지 않아도 제품이 완전히 동작한다(설계서 §10.1) */
  defaultValue: T
  /** 시크릿이면 암호화 저장 + 응답 마스킹 */
  isSecret?: boolean
  /** AI 어시스턴트 경로에서 차단할지 */
  assistantBlocked?: boolean
  /** 되돌리기 어려운 설정 — UI에서 확인 절차 */
  destructive?: boolean
}

const QUIET_HOURS = z.object({
  enabled: z.boolean(),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

const SIZE_BANDS = z.array(z.object({
  label: z.string().min(1),
  min: z.number().int().nonnegative(),
  max: z.number().int().positive().nullable(),
})).min(1)

function def<T>(d: CiSettingDef<T>): CiSettingDef<unknown> {
  return d as unknown as CiSettingDef<unknown>
}

export const CI_SETTING_DEFS: readonly CiSettingDef<unknown>[] = [
  // ── 1. 내 계정 (user) ──────────────────────────────────────────
  def({
    key: 'account.locale', scope: 'user', group: 'account',
    label: '표시 언어', help: '화면에 표시되는 언어입니다.',
    schema: z.enum(['ko', 'en']), defaultValue: 'ko',
  }),
  def({
    key: 'account.timezone', scope: 'user', group: 'account',
    label: '시간대', help: '날짜와 시각을 이 시간대로 표시합니다.',
    schema: z.string().min(1), defaultValue: 'Asia/Seoul',
  }),
  def({
    key: 'notify.channels', scope: 'user', group: 'account',
    label: '알림 수신 채널', help: '떡상 알림과 일간 브리핑을 어디로 받을지 고릅니다.',
    schema: z.array(z.enum(['push', 'email'])), defaultValue: ['push', 'email'],
  }),

  // ── 2. 워크스페이스 일반 ───────────────────────────────────────
  def({
    key: 'ws.locale', scope: 'workspace', group: 'workspace',
    label: '기본 언어', help: '새 멤버에게 적용되는 기본 언어입니다.',
    schema: z.enum(['ko', 'en']), defaultValue: 'ko',
  }),
  def({
    key: 'ws.timezone', scope: 'workspace', group: 'workspace',
    label: '기본 시간대', help: '예약 게시와 브리핑 발송 시각의 기준입니다.',
    schema: z.string().min(1), defaultValue: 'Asia/Seoul',
  }),

  // ── 4. 알림 규칙 ───────────────────────────────────────────────
  def({
    key: 'alert.outlier.threshold', scope: 'workspace', group: 'alert',
    label: '떡상 알림 기준', help: '관심 채널의 새 게시물이 평소 대비 이 배수를 넘으면 알립니다.',
    schema: z.number().min(1.5).max(100), defaultValue: 3,
  }),
  def({
    key: 'alert.brief.send_at', scope: 'workspace', group: 'alert',
    label: '일간 브리핑 시각', help: '매일 이 시각에 오늘의 브리핑을 보냅니다.',
    schema: z.string().regex(/^\d{2}:\d{2}$/), defaultValue: '09:00',
  }),
  def({
    key: 'alert.quiet_hours', scope: 'workspace', group: 'alert',
    label: '방해 금지 시간', help: '이 시간대에는 알림을 보내지 않고 모아두었다가 이후에 전달합니다.',
    schema: QUIET_HOURS, defaultValue: { enabled: false, start: '22:00', end: '08:00' },
  }),

  // ── 5. 데이터와 수집 ───────────────────────────────────────────
  def({
    key: 'ingest.refresh_interval_hours', scope: 'workspace', group: 'data',
    label: '자동 업데이트 주기', help: '관심 채널의 새 게시물을 몇 시간마다 확인할지 정합니다.',
    schema: z.number().int().min(1).max(168), defaultValue: 24,
  }),
  def({
    key: 'snapshot.preset', scope: 'workspace', group: 'data',
    label: '스냅샷 정밀도', help: '지표를 얼마나 자주 기록할지입니다. 정밀할수록 비용이 늘어납니다.',
    schema: z.enum(['economy', 'standard', 'precise']), defaultValue: 'economy',
  }),
  def({
    key: 'data.retention_days', scope: 'workspace', group: 'data',
    label: '데이터 보존 기간', help: '지표 기록을 며칠 동안 보관할지입니다.',
    schema: z.number().int().min(30).max(3650), defaultValue: 365,
    destructive: true,
  }),

  // ── 6. 주제 관리 ───────────────────────────────────────────────
  def({
    key: 'topic.autoconfirm_threshold', scope: 'workspace', group: 'topic',
    label: '주제 자동 확정 기준', help: '분류 확신도가 이 값 이상이면 검토 없이 확정합니다. 낮추면 자동화가 늘고 오분류도 늘어납니다.',
    schema: z.number().min(0.5).max(1), defaultValue: 0.85,
  }),

  // ── 7. 분석 기준 ───────────────────────────────────────────────
  def({
    key: 'analysis.window_days', scope: 'workspace', group: 'analysis',
    label: '기본 기간 창', help: '트렌드와 성과를 계산할 때 기본으로 보는 기간입니다.',
    schema: z.number().int().min(7).max(365), defaultValue: 28,
  }),
  def({
    key: 'analysis.size_bands', scope: 'workspace', group: 'analysis',
    label: '채널 규모 구간', help: '구독자 수를 어떤 구간으로 나눠 비교할지 정합니다.',
    schema: SIZE_BANDS,
    defaultValue: [
      { label: '1만 미만', min: 0, max: 10000 },
      { label: '1만~10만', min: 10000, max: 100000 },
      { label: '10만~100만', min: 100000, max: 1000000 },
      { label: '100만 이상', min: 1000000, max: null },
    ],
  }),

  // ── 8. AI ──────────────────────────────────────────────────────
  def({
    key: 'ai.response_locale', scope: 'workspace', group: 'ai',
    label: 'AI 응답 언어', help: 'AI가 기획안과 답변을 어떤 언어로 작성할지입니다.',
    schema: z.enum(['ko', 'en']), defaultValue: 'ko',
  }),
  def({
    key: 'ai.brand_voice', scope: 'workspace', group: 'ai',
    label: '브랜드 보이스', help: '기획안의 말투 지침입니다. 비워두면 중립적인 톤으로 작성합니다.',
    schema: z.string().max(2000), defaultValue: '',
  }),
  def({
    key: 'ai.automation_level', scope: 'workspace', group: 'ai',
    label: '자동화 수준', help: '자동 확정을 우선할지, 사람 검토를 우선할지 정합니다.',
    schema: z.enum(['auto_first', 'review_first']), defaultValue: 'auto_first',
  }),
  def({
    key: 'ai.daily_call_limit', scope: 'workspace', group: 'ai',
    label: 'AI 일 사용 한도', help: '하루에 쓸 수 있는 AI 호출 횟수입니다. 플랜 한도를 넘을 수 없습니다.',
    schema: z.number().int().min(0).max(100000), defaultValue: 20,
  }),

  // ── 10. 게시 기본값 ────────────────────────────────────────────
  def({
    key: 'publish.default_time', scope: 'workspace', group: 'publish',
    label: '예약 기본 시각', help: '게시를 예약할 때 처음 제안되는 시각입니다.',
    schema: z.string().regex(/^\d{2}:\d{2}$/), defaultValue: '18:00',
  }),
  def({
    key: 'publish.checklist', scope: 'workspace', group: 'publish',
    label: '수동 게시 체크리스트', help: '직접 올릴 때 확인할 항목입니다.',
    schema: z.array(z.string().min(1)),
    defaultValue: ['썸네일 확인', '캡션 복사', '해시태그 확인', '공개 범위 확인'],
  }),

  // ── 13. 운영자 콘솔 (system) ──────────────────────────────────
  def({
    key: 'llm.budget_cap_krw', scope: 'system', group: 'system',
    label: 'LLM 월 예산 상한', help: '이 금액에 도달하면 2·3차 AI 검증을 중단합니다.',
    schema: z.number().int().min(0), defaultValue: 500000,
    assistantBlocked: true,
  }),
  def({
    key: 'flag.ci_enabled', scope: 'system', group: 'system',
    label: '콘텐츠 인텔리전스 활성화', help: '끄면 전체 기능이 비활성화됩니다(킬 스위치).',
    schema: z.boolean(), defaultValue: false,
    assistantBlocked: true, destructive: true,
  }),
]

const BY_KEY = new Map(CI_SETTING_DEFS.map((d) => [d.key, d]))

export function getSettingDef(key: string): CiSettingDef<unknown> | undefined {
  return BY_KEY.get(key)
}

export function listSettingDefs(scope?: CiSettingScope): CiSettingDef<unknown>[] {
  return CI_SETTING_DEFS.filter((d) => !scope || d.scope === scope)
}

export interface ValidationOk { ok: true; value: unknown }
export interface ValidationErr { ok: false; code: string; message: string; details?: unknown }

/**
 * 키 등록 여부 + 스코프 일치 + 값 검증을 한 번에 판정한다.
 * 시크릿을 flag나 일반 설정에 평문으로 넣는 것도 여기서 차단한다.
 */
export function validateSetting(
  key: string,
  scope: CiSettingScope,
  value: unknown,
): ValidationOk | ValidationErr {
  const d = getSettingDef(key)
  if (!d) {
    return { ok: false, code: 'VALIDATION_FAILED', message: `등록되지 않은 설정 키입니다: ${key}` }
  }
  if (d.scope !== scope) {
    return {
      ok: false, code: 'VALIDATION_FAILED',
      message: `설정 '${key}'는 ${d.scope} 스코프 전용입니다`,
    }
  }
  const parsed = d.schema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false, code: 'VALIDATION_FAILED',
      message: `설정 '${key}'의 값이 올바르지 않습니다`,
      details: parsed.error.issues,
    }
  }
  return { ok: true, value: parsed.data }
}

/** 코드 기본값 맵 — 스코프 해석의 마지막 폴백. */
export function codeDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const d of CI_SETTING_DEFS) out[d.key] = d.defaultValue
  return out
}
