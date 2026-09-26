import 'server-only'

/**
 * 저장된 보정·기대값 모델을 읽어 온다
 *
 * 만드는 쪽은 1-B 검증 파이프라인(`validation/pipeline.ts`)이고, 여기는 **읽기만** 한다.
 * 같은 파일에 두면 실시간 경로가 모델을 다시 맞출 수 있게 되고,
 * 장중에 맞춘 모델은 그 장의 결과로 그 장을 판단하는 것이 된다.
 */

import { createAdminClient } from '@/lib/supabase/server'
import { plattParamsFrom, type SignalModels, type Direction } from './models-core.ts'
import type { EvBucket, EvModel } from '../ev/model.ts'

export interface LoadModelsInput {
  judge: string
  direction: Direction
  /** 설정 `calibration_version`. 빈 값이면 가장 최근 판 */
  calibrationVersion: string
  /** 설정 `ev_model_version`. 빈 값이면 가장 최근 판 */
  evModelVersion: string
}

/** 보정 한 줄. 방향마다 따로 있고, 없으면 그 방향은 신호를 못 낸다 */
async function loadCalibration(
  judge: string, direction: string, version: string,
): Promise<{ params: { a: number; b: number }; version: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  let query = admin
    .from('trading_calibrations')
    .select('version, params, method')
    .eq('judge', judge)
    .eq('direction', direction)
    // 등위 회귀는 파라미터 꼴이 달라 여기서 안 읽는다. 읽을 수 있게 되면 그때 더한다
    .eq('method', 'platt')
  if (version !== '') query = query.eq('version', version)
  const { data, error } = await query.order('version', { ascending: false }).limit(1)
  if (error) throw new Error(`보정 모델을 읽지 못했습니다: ${error.message}`)
  const row = (data ?? [])[0] as { version: string; params: unknown } | undefined
  if (!row) return null
  const params = plattParamsFrom(row.params)
  // **파라미터가 이상하면 모델이 없는 것으로 친다.** NaN 을 그대로 쓰면 비교가 전부 거짓이 되어
  // 사유 없이 신호가 안 나간다 — 사유 없이 안 나가는 것이 제일 나쁘다
  return params ? { params, version: row.version } : null
}

/** 기대값 평균표. 구간 여러 줄이 한 판을 이룬다 */
async function loadEvModel(
  judge: string, direction: Direction, version: string,
): Promise<{ model: EvModel; version: string } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  let query = admin
    .from('trading_ev_models')
    .select('version, bucket_from, bucket_to, sample_count, mean_net_pnl_r, train_from, train_to')
    .eq('judge', judge)
    .eq('direction', direction)
  if (version !== '') query = query.eq('version', version)
  const { data, error } = await query.order('version', { ascending: false }).order('bucket_from')
  if (error) throw new Error(`기대값 모델을 읽지 못했습니다: ${error.message}`)
  const rows = (data ?? []) as {
    version: string; bucket_from: number; bucket_to: number
    sample_count: number; mean_net_pnl_r: number | null
    train_from: string; train_to: string
  }[]
  if (rows.length === 0) return null

  // 판을 안 골랐으면 가장 최근 판의 구간만 쓴다. 섞으면 서로 다른 학습 구간이 한 표가 된다
  const newest = rows[0].version
  const picked = rows.filter((r) => r.version === newest)
  const buckets: EvBucket[] = picked.map((r) => ({
    from: Number(r.bucket_from),
    to: Number(r.bucket_to),
    sampleCount: Number(r.sample_count),
    meanNetPnlR: r.mean_net_pnl_r === null ? null : Number(r.mean_net_pnl_r),
  }))
  return {
    model: {
      version: newest,
      judge,
      direction,
      buckets,
      trainFrom: picked[0].train_from,
      trainTo: picked[0].train_to,
    },
    version: newest,
  }
}

/**
 * 한 방향의 모델 묶음. **하나가 실패해도 나머지는 읽는다** —
 * 기대값을 못 읽었다고 보정까지 버리면 「어디서 막혔나」를 못 말한다.
 */
export async function loadSignalModels(input: LoadModelsInput): Promise<SignalModels> {
  const [calibration, ev, enterNow] = await Promise.all([
    loadCalibration(input.judge, input.direction, input.calibrationVersion),
    loadEvModel(input.judge, input.direction, input.evModelVersion),
    /**
     * `enter_now` 는 방향이 아니라 **지금 들어가도 되나**를 묻는다(§7.3).
     * 방향 보정과 같은 표를 쓰되 `direction` 자리에 고른 방향을 그대로 넣는다 —
     * 따로 표를 만들면 그 표가 빈 날 SR-02 가 조용히 통과한다
     */
    loadCalibration(input.judge, input.direction, input.calibrationVersion),
  ])
  return { direction: input.direction, calibration, ev, enterNowCalibration: enterNow }
}
