import 'server-only'

/**
 * 게이트가 볼 값을 실제로 잰다
 *
 * ## 왜 이 파일이 늦게 생겼나
 *
 * 크론이 안전 게이트에 넘기던 값 여섯이 **손으로 쓴 고정값**이었다(실측 2026-09-26).
 * `hasCalibration: false`, `hasActiveSpec: false`, `marginTight: false`,
 * `aiBudgetExhausted: false`, `minutesSinceLastRun: 0`,
 * 그리고 `brokerFailureStreak` 는 `brokerFailureStreak([{ ok: false }])` 로
 * **그 자리에서 배열을 만들어** 넘겨 언제나 1 이었다.
 *
 * 부르는 꼴만 보면 「재고 있다」로 보인다. 인자를 따라가야 안 재는 것이 보인다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { brokerFailureStreak } from '../broker/account-request.ts'
import { serverBudgetGate } from '@/lib/ai/budget-gate'
import { marginTightFrom, minutesSince, foldMeasurement, type GateMeasurement } from './measure-core.ts'
import type { AccountClient } from '../broker/account.ts'

/** 실행 기록 사유에 싣는 표식. 다음 실행이 이것을 세어 연속 실패를 잰다 */
export const BROKER_OK_MARK = 'broker=ok'
export const BROKER_FAILED_MARK = 'broker=failed'

/**
 * 증권사 조회가 **연달아** 몇 번 실패했나.
 *
 * 한 실행 안에서 세면 「이번에 몇 개 실패했나」이지 「며칠째 안 되나」가 아니다.
 * 그래서 지난 실행들의 사유에 남긴 표식을 뒤에서부터 센다 — 표식은 약속이지 짐작이 아니다.
 */
export async function loadBrokerStreak(jobName: string, limit = 10): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_job_runs')
    .select('reason')
    .eq('job_name', jobName)
    .order('scheduled_minute', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`실행 기록을 읽지 못했습니다: ${error.message}`)
  const recent = ((data ?? []) as { reason: string | null }[])
    // 표식이 없는 실행은 증권사에 닿지도 않은 실행이다. 실패로 세지 않는다
    .filter((row) => (row.reason ?? '').includes(BROKER_OK_MARK) || (row.reason ?? '').includes(BROKER_FAILED_MARK))
    .map((row) => ({ ok: !(row.reason ?? '').includes(BROKER_FAILED_MARK) }))
  return brokerFailureStreak(recent)
}

/**
 * **직전** 실행 시각. 없으면 null.
 *
 * 이번 실행의 줄을 빼야 한다 — `startJobRun` 이 이미 이번 분 줄을 넣어 두었고,
 * 그것까지 세면 「마지막 실행 이후 0분」이 언제나 답이 되어 SG-03(크론 정지)이
 * **영원히 안 걸린다.** 자기를 재는 자는 언제나 건강하다.
 */
export async function loadLastRunAt(
  jobName: string, thisScheduledMinute: Date,
): Promise<Date | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data, error } = await admin
    .from('trading_job_runs')
    .select('scheduled_minute')
    .eq('job_name', jobName)
    .lt('scheduled_minute', thisScheduledMinute.toISOString())
    .order('scheduled_minute', { ascending: false })
    .limit(1)
  if (error) throw new Error(`마지막 실행을 읽지 못했습니다: ${error.message}`)
  const at = (data ?? [])[0]?.scheduled_minute as string | undefined
  return at ? new Date(at) : null
}

/** 이 판 번호로 맞춘 보정 모델이 있나. 판 번호를 안 정했으면 아무 줄이나 있으면 된다 */
export async function hasCalibrationRow(version: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  let query = admin.from('trading_calibrations').select('version', { count: 'exact', head: true })
  if (version !== '') query = query.eq('version', version)
  const { count, error } = await query
  if (error) throw new Error(`보정 모델을 세지 못했습니다: ${error.message}`)
  return (count ?? 0) > 0
}

export interface MeasureInput {
  jobName: string
  now: Date
  /** 이번 실행이 맡은 분. 직전 실행을 찾을 때 이 줄을 뺀다 */
  scheduledMinute: Date
  account: AccountClient | null
  /** 이번 실행에서 증권사 조회가 하나라도 실패했나 */
  brokerFailedThisRun: boolean
  /** 설정에 적힌 값들 */
  calibrationVersion: string
  specVersion: string
  tightRatePercent: number
  /** AI 예산을 물을 창구 이름 */
  aiSurface: string
}

/**
 * 여섯을 잰다. **하나가 실패해도 나머지는 잰다** —
 * 한 값을 못 읽었다고 게이트 전체를 포기하면 그때가 제일 위험한 순간이다.
 */
export async function measureGate(input: MeasureInput): Promise<GateMeasurement> {
  const unreadable: string[] = []
  const tryRead = async <T>(name: string, read: () => Promise<T>): Promise<T | null> => {
    try { return await read() } catch { unreadable.push(name); return null }
  }

  const [streak, lastRunAt, calibration, deposit, budget] = await Promise.all([
    tryRead('brokerStreak', () => loadBrokerStreak(input.jobName)),
    tryRead('lastRun', () => loadLastRunAt(input.jobName, input.scheduledMinute)),
    tryRead('calibration', () => hasCalibrationRow(input.calibrationVersion)),
    input.account
      ? tryRead('deposit', async () => {
        const r = await input.account!.deposit()
        return r.ok ? r.value : null
      })
      : Promise.resolve(null),
    tryRead('aiBudget', async () => {
      const decision = await serverBudgetGate().check(input.aiSurface, input.now)
      return !decision.allowed
    }),
  ])

  const folded = foldMeasurement({
    /**
     * 못 읽었으면 이번 실행 결과만으로 센다. 0 으로 두면 「잘 되고 있다」가 되는데
     * 못 읽었다는 것 자체가 DB 가 이상하다는 뜻이라 그것이 제일 위험한 가정이다.
     */
    brokerFailureStreak: streak ?? (input.brokerFailedThisRun ? 1 : 0),
    minutesSinceLastRun: minutesSince(lastRunAt, input.now),
    hasCalibration: calibration,
    // 판 번호를 정해 놓은 것이 「활성 스펙이 있다」이다. 빈 값이면 아무 판도 안 고른 것
    hasActiveSpec: input.specVersion.trim() === '' ? false : true,
    marginTight: deposit
      ? marginTightFrom({
        additionalMarginKrw: deposit.additionalMarginKrw,
        maintenanceRate: deposit.maintenanceRate,
        tightRatePercent: input.tightRatePercent,
      })
      : null,
    aiBudgetExhausted: budget,
  })
  return { ...folded, unmeasured: [...folded.unmeasured, ...unreadable] }
}
