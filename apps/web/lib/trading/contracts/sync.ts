import 'server-only'

/**
 * 월물 동기화 — **거래소가 상장한 것만 조회한다**
 *
 * 매 거래일 장 시작 전에 KIS 종목정보 마스터를 받아 월물 목록과 근월물을 갱신한다.
 * 못 받으면 설정의 「근월물 코드 직접 지정」으로 진행하고 **그 사실을 사유로 남긴다**(명세 §20).
 * 조용히 어제 값을 쓰면 교체일 다음 날 만기 지난 월물로 하루를 통째로 판단한다.
 *
 * ## 왜 직접 압축을 푸나
 *
 * 마스터는 항목 하나짜리 zip 이다. 그것 하나를 풀려고 의존성을 늘리지 않는다 —
 * 로컬 파일 머리를 읽고 `zlib.inflateRawSync` 로 푸는 것이 전부이고, 형식이 맞지 않으면
 * 그 자리에서 사유와 함께 멈춘다(추측해서 이어 가지 않는다).
 */

import { inflateRawSync } from 'node:zlib'
import { createAdminClient } from '@/lib/supabase/server'
import { KIS_INDEX_FUTURE_MASTER_URL } from '../broker/endpoints.ts'
import {
  parseIndexFutureMaster,
  contractsOf,
  frontContractOf,
  type ContractInfo,
  type InstrumentRoot,
} from './contract-rules.ts'

/** 로컬 파일 머리의 서명. 이것이 아니면 우리가 아는 zip 이 아니다 */
const LOCAL_FILE_HEADER = 0x04034b50

/**
 * 항목 하나짜리 zip 에서 첫 항목의 본문을 꺼낸다.
 *
 * 압축 방식은 0(무압축)과 8(deflate)만 받는다. 그 밖이면 **추측하지 않고 던진다.**
 */
export function unzipSingleEntry(buffer: Buffer): Buffer {
  if (buffer.length < 30 || buffer.readUInt32LE(0) !== LOCAL_FILE_HEADER) {
    throw new Error('종목정보 파일이 zip 형식이 아닙니다')
  }
  const method = buffer.readUInt16LE(8)
  const compressedSize = buffer.readUInt32LE(18)
  const nameLength = buffer.readUInt16LE(26)
  const extraLength = buffer.readUInt16LE(28)
  const start = 30 + nameLength + extraLength
  // 크기가 0 으로 적혀 오는 스트리밍 zip 은 끝을 알 수 없다. 그때는 뒤쪽 전부를 넘긴다
  const end = compressedSize > 0 ? start + compressedSize : buffer.length
  const body = buffer.subarray(start, end)
  if (method === 0) return body
  if (method === 8) return inflateRawSync(body)
  throw new Error(`종목정보 파일의 압축 방식을 모릅니다: ${method}`)
}

export interface SyncResult {
  ok: boolean
  /** 기계가 읽는 사유. 성공이어도 어떤 길로 갔는지 남긴다 */
  reason: string
  userMessage: string | null
  contracts: ContractInfo[]
  frontCode: string | null
  /** 마스터를 못 받아 설정값으로 갔나 */
  usedOverride: boolean
}

async function downloadMaster(): Promise<string> {
  const response = await fetch(KIS_INDEX_FUTURE_MASTER_URL, { cache: 'no-store' })
  if (!response.ok) throw new Error(`종목정보를 받지 못했습니다: HTTP ${response.status}`)
  const zipped = Buffer.from(await response.arrayBuffer())
  // 마스터는 cp949(euc-kr) 로 적혀 있다. utf-8 로 읽으면 한글종목명이 깨져 월물을 못 읽는다
  return new TextDecoder('euc-kr').decode(unzipSingleEntry(zipped))
}

export interface SyncInput {
  root: InstrumentRoot
  /** 설정 `front_contract_code_override`. 비어 있으면 대체 경로가 없다 */
  overrideFrontCode: string
  /** `YYYY-MM-DD` (서울). 갱신 시각 기준 */
  today: string
  holidays?: ReadonlySet<string>
}

/**
 * 월물 목록을 갱신하고 지금 근월물을 돌려준다.
 *
 * 실패해도 던지지 않는다 — 이 함수를 부르는 곳은 분마다 도는 크론이고,
 * 던지면 그 분의 다른 일(봉 수집)까지 같이 죽는다. 대신 사유를 실어 돌려준다.
 */
export async function syncContracts(input: SyncInput): Promise<SyncResult> {
  let text: string
  try {
    text = await downloadMaster()
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류'
    if (input.overrideFrontCode.trim() !== '') {
      return {
        ok: true,
        reason: `master_unavailable_used_override:${message}`,
        userMessage: '종목정보를 받지 못해 설정에 지정한 근월물 코드로 진행합니다',
        contracts: [],
        frontCode: input.overrideFrontCode.trim(),
        usedOverride: true,
      }
    }
    return {
      ok: false,
      reason: `master_unavailable:${message}`,
      userMessage: '종목정보를 받지 못했고 설정에 근월물 코드도 없습니다. 설정에서 근월물 코드를 지정해 주세요',
      contracts: [],
      frontCode: null,
      usedOverride: false,
    }
  }

  const { rows, dropped } = parseIndexFutureMaster(text)
  const contracts = contractsOf(rows, input.root, input.holidays)
  const front = frontContractOf(contracts)

  if (!front) {
    return {
      ok: input.overrideFrontCode.trim() !== '',
      reason: `no_front_contract:rows=${rows.length},dropped=${dropped}`,
      userMessage: '종목정보에서 근월물을 찾지 못했습니다',
      contracts,
      frontCode: input.overrideFrontCode.trim() || null,
      usedOverride: input.overrideFrontCode.trim() !== '',
    }
  }

  await persist(contracts, input)

  return {
    ok: true,
    reason: `synced:contracts=${contracts.length},dropped=${dropped}`,
    userMessage: null,
    contracts,
    frontCode: front.code,
    usedOverride: false,
  }
}

async function persist(contracts: readonly ContractInfo[], input: SyncInput): Promise<void> {
  if (contracts.length === 0) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any

  const { data: instrument, error: readError } = await admin
    .from('trading_instruments')
    .select('id')
    .eq('root', input.root)
    .maybeSingle()
  if (readError) throw new Error(`상품을 읽지 못했습니다: ${readError.message}`)
  if (!instrument) throw new Error(`상품 규격이 없습니다: ${input.root}`)

  const now = new Date().toISOString()
  const rows = contracts.map((c) => {
    return {
      code: c.code,
      instrument_id: instrument.id,
      expiry_month: c.expiryMonth,
      // contractsOf 가 이미 같은 휴장일로 계산했다. 여기서 다시 계산하면 두 값이 갈린다
      last_trading_day: c.lastTradingDay,
      is_front: c.isFront,
      synced_at: now,
      // 이 사실을 실제로 알게 된 시각. 백테스트가 미래를 안 보게 하는 자물쇠다(§6.5)
      available_at: now,
    }
  })

  const { error } = await admin.from('trading_contracts').upsert(rows, { onConflict: 'code' })
  if (error) throw new Error(`월물을 저장하지 못했습니다: ${error.message}`)
}
