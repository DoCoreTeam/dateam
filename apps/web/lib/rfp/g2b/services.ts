/**
 * 공공데이터포털 서비스 등록부 (기획서 8절)
 *
 * ## 키는 하나인데 신청은 여섯 번이다
 *
 * 같은 서비스 키로 아래 여섯이 열리지만, **활용 신청은 서비스마다 따로** 하고
 * 일일 한도도 따로 센다. 하나를 신청했다고 나머지가 열리지 않는다.
 *
 * ## 신청 안 한 것을 고장이라 말하지 않는다
 *
 * 신청 안 된 서비스를 부르면 포털이 거절한다. 그때 「나라장터가 응답하지 않습니다」라고
 * 말하면 사용자는 포털이 고장 났다고 읽고 기다린다. 기다려도 안 열린다 —
 * 열려면 **우리가 신청**해야 한다. 그래서 그 둘을 사유로 갈라 둔다.
 *
 * ## 한도를 넘기면 수집이 조용히 멈춘다
 *
 * 한도 초과도 거절이라 모양이 같다. 갈라 두지 않으면 어느 날부터 공고가 안 들어오는데
 * 아무도 이유를 모른다.
 */

export type G2bServiceId =
  | 'bidPublicInfo'
  | 'preStandard'
  | 'scsbid'
  | 'contract'
  | 'contractProcess'
  | 'nuri'

export interface G2bService {
  id: G2bServiceId
  /** 공공데이터포털의 데이터 번호. 신청할 때 이 번호로 찾는다 */
  portalNo: string
  /** 이 서비스만의 주소 조각 */
  base: string
  /** 무엇을 주는가. 비어 있으면 왜 신청해야 하는지 아무도 모른다 */
  gives: string
  /** 지금 코드가 쓰고 있나 */
  inUse: boolean
}

export const G2B_SERVICES: readonly G2bService[] = [
  {
    id: 'bidPublicInfo',
    portalNo: '15129394',
    base: 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService',
    gives: 'bid_list_detail_base_price_license_region_amendments',
    inUse: true,
  },
  {
    id: 'preStandard',
    portalNo: '15129437',
    base: 'https://apis.data.go.kr/1230000/as/PubPrcrmntPreStdService',
    // 공고 전에 규격서와 배정예산이 뜬다. 레이더가 며칠 앞당겨지는 자리
    gives: 'pre_spec_before_notice_budget_and_public_comment',
    inUse: false,
  },
  {
    id: 'scsbid',
    portalNo: '15129397',
    base: 'https://apis.data.go.kr/1230000/as/ScsbidInfoService',
    gives: 'winner_ranking_reserve_price_failed_bids',
    inUse: false,
  },
  {
    id: 'contract',
    portalNo: '15129427',
    base: 'https://apis.data.go.kr/1230000/ao/CntrctInfoService',
    gives: 'contract_list_and_amendments',
    inUse: false,
  },
  {
    id: 'contractProcess',
    portalNo: '15129459',
    base: 'https://apis.data.go.kr/1230000/at/BidPblancListInfoServc',
    gives: 'whole_process_by_one_number',
    inUse: false,
  },
  {
    id: 'nuri',
    portalNo: '15129456',
    base: 'https://apis.data.go.kr/1230000/at/NuriMrktInfoService',
    gives: 'private_sector_bids',
    inUse: false,
  },
]

export function serviceOf(id: G2bServiceId): G2bService {
  const hit = G2B_SERVICES.find((s) => s.id === id)
  if (!hit) throw new Error(`unregistered portal service: ${id}`)
  return hit
}

/** 아직 코드가 안 쓰는 서비스 */
export function unusedServices(): G2bService[] {
  return G2B_SERVICES.filter((s) => !s.inUse)
}

/**
 * 포털이 돌려주는 거절 사유.
 *
 * 값은 공공데이터포털이 문서로 정한 코드다. 서비스 키가 아직 없어 **실제 호출로는
 * 확인하지 못했다** — 키가 생기면 한 번 불러 코드가 이 표와 맞는지 확인해야 한다.
 */
export type PortalReject = 'not_registered' | 'quota_exceeded' | 'bad_key' | 'unknown'

const PORTAL_CODE: Record<string, PortalReject> = {
  '30': 'not_registered',
  SERVICE_KEY_IS_NOT_REGISTERED_ERROR: 'not_registered',
  '22': 'quota_exceeded',
  LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR: 'quota_exceeded',
  '31': 'bad_key',
  DEADLINE_HAS_EXPIRED_ERROR: 'bad_key',
  '32': 'bad_key',
  UNREGISTERED_IP_ERROR: 'bad_key',
}

/** 포털 응답에서 거절 사유를 읽는다. 모르면 모른다고 한다 */
export function rejectOf(code: string | null | undefined): PortalReject {
  if (!code) return 'unknown'
  return PORTAL_CODE[code.trim()] ?? 'unknown'
}

/**
 * 거절마다 사용자가 할 일.
 *
 * 「실패」만 말하면 사용자가 할 일이 없다. 신청은 우리가, 한도는 기다림이,
 * 키 문제는 설정이 답이라 셋이 다르다.
 */
export const REJECT_NEXT: Record<PortalReject, 'apply' | 'wait' | 'fix_key' | 'report'> = {
  not_registered: 'apply',
  quota_exceeded: 'wait',
  bad_key: 'fix_key',
  unknown: 'report',
}
