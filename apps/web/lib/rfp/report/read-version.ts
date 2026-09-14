/**
 * 저장된 리포트를 읽는 한 자리
 *
 * ## 왜 한 자리인가
 *
 * 리포트 원본을 읽는 곳이 여섯이다 — 화면, 내보내기, 제안서, 비교, 차수, 교차검증.
 * 사다리를 각자 부르면 한 곳만 안 부르는 날이 오고, **그 화면만 옛 판을 새 판인 척 읽는다.**
 * 그때 화면은 멀쩡해 보인다. 값이 조금 다를 뿐이라 아무도 못 알아챈다.
 *
 * ## 못 올린 값을 어떻게 하나
 *
 * 버리지 않는다. 원문 그대로 돌려주고 **이전 방식으로 만든 것**이라고만 말한다.
 * 값이 사라지는 것이 값이 낡은 것보다 나쁘다.
 *
 * 화면에 적는 말은 여기서 짓지 않고 용어집에서 가져온다.
 */

import { climb, isCurrent } from '@ax/ai-core'
import { contractNote } from '../../terms/index.ts'
import type { Report } from './schema.ts'

/** 저장된 행에서 우리가 보는 두 칸 */
export interface StoredReportRow {
  report: unknown
  contract_version?: number | null
}

export interface ReadReport {
  report: Report
  /** 지금 계약으로 읽을 수 있나 */
  current: boolean
  /** 못 읽는다면 화면에 적을 한 줄. 읽을 수 있으면 null */
  note: string | null
  /** 어느 판으로 저장됐나. 판 번호가 없던 시절이면 null */
  storedVersion: number | null
}

/**
 * 행 하나를 읽는다. 행이 없으면 null.
 *
 * `report` 자체에는 판 번호가 없고 **행의 칸**에 있다. 그래서 칸을 섞어 사다리에 넘긴다.
 */
export function readStoredReport(row: StoredReportRow | null | undefined): ReadReport | null {
  if (!row || row.report === null || row.report === undefined) return null

  const stamped = typeof row.report === 'object'
    ? { ...(row.report as object), contract_version: row.contract_version ?? undefined }
    : row.report
  const climbed = climb(stamped)

  if (isCurrent(climbed)) {
    return {
      report: row.report as Report,
      current: true,
      note: null,
      storedVersion: climbed.storedVersion,
    }
  }
  return {
    report: row.report as Report,
    current: false,
    note: contractNote(climbed.status),
    storedVersion: climbed.storedVersion,
  }
}

/** 읽는 쪽이 select 에 반드시 넣어야 하는 칸. 빠뜨리면 모든 행이 이전 판으로 보인다 */
export const REPORT_VERSION_COLUMNS = 'report, contract_version'
