// 자동화 (dacrm FR-08)
//
// **왜 필요한가**: 영업에서 잊히는 일은 "생각이 안 나서"가 아니라 **손이 안 가서**다.
// 제안을 보냈으면 사흘 뒤 확인 전화를 해야 하는데, 그 할 일을 만드는 데 30초가 든다.
// 30초가 아까워서가 아니라, 딜 열두 개를 옮기고 나면 그 30초가 열두 번이라 안 하게 된다.
// 그래서 **단계를 옮기는 순간 할 일이 저절로 생기게** 한다.
//
// **새 테이블을 만들지 않는다.**
// 규칙은 이미 있는 워크스페이스 설정(`crm_app_setting`)에 JSON 으로 넣고,
// 실행 기록은 이미 있는 감사 로그에 남긴다.
// 그러면 "이 할 일 누가 만들었지"가 **기존 기록 화면에서 그대로 보인다** — 화면을 새로 만들 필요도 없다.
// (운영 DB 스키마 변경은 되돌리기 어렵다. 형태를 바꿔 승인 없이 갈 수 있으면 그렇게 한다.)
//
// **하지 않는 것**: 이메일 발송·웹훅 같은 **밖으로 나가는 행동**은 넣지 않았다.
// 자동으로 나간 메일은 되돌릴 수 없고, 사람이 보낸 것처럼 읽힌다.
// 안에서 할 일을 만드는 것까지가 되돌릴 수 있는 범위다.

import type { Prisma } from '@prisma/client'
import { CrmError } from '../domain/errors.ts'
import { writeAudit } from '../db/audit.ts'
import type { CrmDb } from '../db/client.ts'
import { kstDateKey } from '../../datetime/kst.ts'

/** 규칙을 담아 두는 설정 키 — 워크스페이스마다 하나 */
export const AUTOMATION_SETTING_KEY = 'automation.rules'

/** 한 판에 훑는 딜 수 — 늘어나도 한 판이 서버리스 시간 제한을 안 넘게 */
const STALLED_SCAN_LIMIT = 500

/** 한 워크스페이스가 가질 수 있는 규칙 수 — 넘으면 사람이 전체를 못 읽는다 */
export const MAX_RULES = 20

/** 언제 도나 */
export type TriggerKind =
  /** 딜이 어떤 단계로 들어왔을 때 */
  | 'deal.entered_stage'
  /** 딜이 성사됐을 때 */
  | 'deal.won'
  /** 딜이 실패했을 때 */
  | 'deal.lost'
  /** 한 단계에 너무 오래 머물 때 (매일 한 번 확인) */
  | 'deal.stalled'

export const TRIGGER_LABEL: Record<TriggerKind, string> = {
  'deal.entered_stage': '딜이 이 단계에 들어오면',
  'deal.won': '딜이 성사되면',
  'deal.lost': '딜이 실패하면',
  'deal.stalled': '딜이 한 단계에 오래 머물면',
}

/** 무엇을 하나 — 되돌릴 수 있는 것만 */
export type ActionKind = 'create_task'

export const ACTION_LABEL: Record<ActionKind, string> = {
  create_task: '할 일 만들기',
}

export interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  trigger: TriggerKind
  /** entered_stage 면 어느 단계인지. 없으면 모든 단계 */
  stageId?: string | null
  /** stalled 면 며칠부터인지 */
  stalledDays?: number | null
  /** 이 금액 이상일 때만 (minor 단위, 문자열로 보관 — BigInt 는 JSON 이 안 된다) */
  minAmountMinor?: string | null
  action: ActionKind
  /** 할 일 제목. `{딜}` 은 딜 이름, `{회사}` 는 회사 이름으로 바뀐다 */
  taskTitle: string
  /** 며칠 뒤가 기한인가 */
  taskDueInDays?: number | null
}

/** 기한을 이만큼 뒤로 미룬다고 할 때의 상한 — 1년을 넘기면 사실상 기한이 없는 것이다 */
const MAX_DUE_DAYS = 365
/** 며칠을 머물러야 "오래"인가의 상한 */
const MAX_STALLED_DAYS = 365

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function posInt(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const i = Math.floor(n)
  if (i < 1 || i > max) return null
  return i
}

/**
 * 저장된 JSON 을 규칙으로 읽는다.
 *
 * **손상된 규칙 하나가 전체를 멈추면 안 된다.** 설정은 사람이 손으로 고칠 수 있고,
 * 옛 판이 남아 있을 수도 있다. 읽을 수 없는 항목은 조용히 버리고 나머지를 살린다 —
 * 반대로 하면 규칙 하나가 깨진 날 딜 이동이 통째로 막힌다.
 */
export function parseRules(raw: unknown): AutomationRule[] {
  if (!Array.isArray(raw)) return []
  const out: AutomationRule[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>

    const id = str(r.id)
    const name = str(r.name)
    const trigger = str(r.trigger) as TriggerKind
    const action = str(r.action) as ActionKind
    const taskTitle = str(r.taskTitle)

    if (!id || seen.has(id)) continue
    if (!(trigger in TRIGGER_LABEL)) continue
    if (!(action in ACTION_LABEL)) continue
    if (!taskTitle) continue

    seen.add(id)
    out.push({
      id,
      name: name || taskTitle,
      // 켜짐이 기본이 아니다 — 만들자마자 도는 것보다 사람이 켜는 편이 안전하다
      enabled: r.enabled === true,
      trigger,
      stageId: str(r.stageId) || null,
      stalledDays: posInt(r.stalledDays, MAX_STALLED_DAYS),
      minAmountMinor: /^\d+$/.test(str(r.minAmountMinor)) ? str(r.minAmountMinor) : null,
      action,
      taskTitle,
      taskDueInDays: posInt(r.taskDueInDays, MAX_DUE_DAYS),
    })
    if (out.length >= MAX_RULES) break
  }
  return out
}

export interface DealFacts {
  id: string
  name: string
  companyName: string | null
  stageId: string
  amountMinor: bigint | string | null
  /** stalled 판정용 — 지금 단계에 들어온 시각 */
  stageEnteredAt?: Date | string | null
}

/** 지금 이 사실에 이 규칙이 걸리나 */
export function matches(
  rule: AutomationRule,
  event: TriggerKind,
  deal: DealFacts,
  now: Date,
): boolean {
  if (!rule.enabled) return false
  if (rule.trigger !== event) return false

  // 단계를 지정했으면 그 단계일 때만
  if (rule.stageId && rule.stageId !== deal.stageId) return false

  // 금액 문턱 — 금액을 모르는 딜은 걸리지 않는다(모르는 것을 "작다"로 치면 안 된다)
  if (rule.minAmountMinor) {
    if (deal.amountMinor === null || deal.amountMinor === undefined) return false
    try {
      if (BigInt(deal.amountMinor) < BigInt(rule.minAmountMinor)) return false
    } catch {
      return false
    }
  }

  if (event === 'deal.stalled') {
    const days = rule.stalledDays
    if (!days || !deal.stageEnteredAt) return false
    const since = new Date(deal.stageEnteredAt)
    if (Number.isNaN(since.getTime())) return false
    const elapsed = (now.getTime() - since.getTime()) / 86_400_000
    if (elapsed < days) return false
  }

  return true
}

/** 제목의 `{딜}`·`{회사}` 를 실제 값으로 */
export function renderTitle(template: string, deal: DealFacts): string {
  return template
    .replaceAll('{딜}', deal.name)
    .replaceAll('{회사}', deal.companyName ?? '')
    .trim()
    .slice(0, 200)
}

/** 기한을 KST 날짜로 — 시각까지 정하면 "오늘까지"가 사람마다 달라진다 */
export function dueDateOf(rule: AutomationRule, now: Date): string | null {
  if (!rule.taskDueInDays) return null
  return kstDateKey(new Date(now.getTime() + rule.taskDueInDays * 86_400_000).toISOString())
}

export interface RunResult {
  ruleId: string
  taskId: string
  title: string
}

/**
 * 규칙을 실행한다.
 *
 * **절대 던지지 않는다.** 자동화가 실패했다고 딜 이동이 되돌아가면
 * 사람은 "왜 저장이 안 되지"만 겪고 원인은 모른다.
 * 실패는 감사 로그에 남기고 이동은 그대로 통과시킨다.
 */
export async function runAutomations(
  tx: Prisma.TransactionClient,
  opts: {
    rules: AutomationRule[]
    event: TriggerKind
    deal: DealFacts
    actorId: string | null
    now?: Date
  },
): Promise<RunResult[]> {
  const now = opts.now ?? new Date()
  const done: RunResult[] = []

  for (const rule of opts.rules) {
    if (!matches(rule, opts.event, opts.deal, now)) continue

    const title = renderTitle(rule.taskTitle, opts.deal)
    if (!title) continue

    try {
      const due = dueDateOf(rule, now)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const task = await (tx as any).crmTask.create({
        data: {
          title,
          status: 'TODO',
          dealId: opts.deal.id,
          dueAt: due ? new Date(`${due}T00:00:00+09:00`) : null,
          createdById: opts.actorId,
        },
        select: { id: true },
      })

      // 사람이 만든 것과 구분되게 남긴다 — "내가 안 만들었는데 왜 있지"에 답할 수 있어야 한다
      await writeAudit(tx, {
        actorType: 'SYSTEM',
        actorId: null,
        action: 'automation.task_created',
        targetType: 'task',
        targetId: task.id,
        afterJson: { ruleId: rule.id, ruleName: rule.name, dealId: opts.deal.id, title },
      })

      done.push({ ruleId: rule.id, taskId: task.id, title })
    } catch (e) {
      // 규칙 하나가 실패해도 나머지는 돈다. 그리고 실패했다는 사실은 반드시 남긴다
      await writeAudit(tx, {
        actorType: 'SYSTEM',
        actorId: null,
        action: 'automation.failed',
        targetType: 'deal',
        targetId: opts.deal.id,
        afterJson: { ruleId: rule.id, reason: e instanceof Error ? e.message : String(e) },
      }).catch(() => { /* 기록마저 실패하면 그냥 넘어간다 — 사용자 저장을 막지 않는다 */ })
    }
  }

  return done
}

/**
 * 이 워크스페이스의 규칙을 읽는다.
 *
 * 없으면 빈 배열 — 자동화를 안 쓰는 워크스페이스가 기본이다.
 * 읽기가 실패해도 던지지 않는다: 규칙을 못 읽었다고 딜 이동이 막히면 안 된다.
 */
export async function loadRules(db: CrmDb | Prisma.TransactionClient): Promise<AutomationRule[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await (db as any).crmAppSetting.findFirst({
      where: { key: AUTOMATION_SETTING_KEY },
      select: { valueJson: true },
    })
    return parseRules(row?.valueJson)
  } catch {
    return []
  }
}

/** 저장 전에 검증한다 — 화면이 막아도 API 로 들어온다 */
export function validateRules(raw: unknown): AutomationRule[] {
  if (!Array.isArray(raw)) {
    throw new CrmError('VALIDATION_FAILED', '자동화 규칙 목록이 아닙니다.', { field: 'rules' })
  }
  if (raw.length > MAX_RULES) {
    throw new CrmError('VALIDATION_FAILED', `규칙은 ${MAX_RULES}개까지 만들 수 있습니다.`, { field: 'rules' })
  }

  const parsed = parseRules(raw)
  // 넣은 것보다 적게 나왔다면 읽을 수 없는 항목이 있었다는 뜻이다.
  // 저장은 조용히 버리지 않는다 — 사람이 만든 규칙이 사라지면 "저장했는데 없다"가 된다
  if (parsed.length !== raw.length) {
    throw new CrmError(
      'VALIDATION_FAILED',
      '규칙에 빠진 값이 있습니다. 이름·시점·할 일 제목을 모두 채워 주세요.',
      { field: 'rules' },
    )
  }
  return parsed
}

/**
 * 오래 머문 딜을 훑어 규칙을 돌린다 (트리거 `deal.stalled`).
 *
 * **왜 따로 있나**: 다른 트리거는 사람이 무언가를 할 때 발화한다.
 * 그런데 "오래 머물렀다"는 **아무 일도 안 일어난 것**이 사건이다.
 * 아무도 안 건드리니 발화할 자리가 없다 — 그래서 하루 한 번 훑는다.
 *
 * **같은 딜에 매일 할 일을 만들면 안 된다.** 이레째부터 매일 하나씩 쌓이면
 * 그 목록은 그날로 죽는다. 그래서 이 딜·이 규칙으로 이미 만든 적이 있으면 건너뛴다.
 */
export async function runStalledSweep(
  db: CrmDb,
  runTx: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>,
  now: Date = new Date(),
): Promise<{ scanned: number; created: number }> {
  const rules = (await loadRules(db)).filter((r) => r.trigger === 'deal.stalled' && r.enabled)
  if (rules.length === 0) return { scanned: 0, created: 0 }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals = await (db as any).crmDeal.findMany({
    where: { status: 'OPEN' },
    select: {
      id: true, name: true, stageId: true, amountMinor: true,
      updatedAt: true, company: { select: { name: true } },
    },
    take: STALLED_SCAN_LIMIT,
    orderBy: { updatedAt: 'asc' },
  }) as {
    id: string; name: string; stageId: string; amountMinor: bigint | null
    updatedAt: Date; company: { name: string } | null
  }[]

  let created = 0
  for (const d of deals) {
    // 지금 단계에 언제 들어왔는지 — 이력이 없으면 딜이 마지막으로 바뀐 때로 본다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hist = await (db as any).crmStageHistory.findFirst({
      where: { dealId: d.id, toStageId: d.stageId },
      orderBy: { movedAt: 'desc' },
      select: { movedAt: true },
    })
    const facts: DealFacts = {
      id: d.id, name: d.name, stageId: d.stageId, amountMinor: d.amountMinor,
      companyName: d.company?.name ?? null,
      stageEnteredAt: hist?.movedAt ?? d.updatedAt,
    }

    const due = rules.filter((r) => matches(r, 'deal.stalled', facts, now))
    if (due.length === 0) continue

    // 이미 만든 적 있는 규칙은 뺀다 — 안 그러면 매일 하나씩 쌓인다
    const fresh: AutomationRule[] = []
    for (const r of due) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seen = await (db as any).crmAuditLog.findFirst({
        where: {
          action: 'automation.task_created',
          afterJson: { path: ['ruleId'], equals: r.id },
        },
        select: { id: true, afterJson: true },
      })
      const sameDeal = seen && (seen.afterJson as { dealId?: string } | null)?.dealId === d.id
      if (!sameDeal) fresh.push(r)
    }
    if (fresh.length === 0) continue

    const done = await runTx((tx) =>
      runAutomations(tx, { rules: fresh, event: 'deal.stalled', deal: facts, actorId: null, now }),
    )
    created += done.length
  }

  return { scanned: deals.length, created }
}
