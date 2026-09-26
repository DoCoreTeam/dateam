/**
 * KIS 주소 — **우리가 정한 값만 나간다**
 *
 * ## 왜 상수인가 (보안 S4)
 *
 * 밖으로 나가는 요청의 주소가 DB 나 사용자 입력에서 오면 사설망이나 클라우드
 * 메타데이터 주소(169.254.169.254)를 물릴 수 있다. 이 모듈이 부르는 곳은 **한 벤더 둘뿐**이고
 * 경로도 코드에 박혀 있다. 주소 조립에 바깥 값이 끼어들 자리가 없다.
 *
 * ## 왜 주문 경로가 없나 (M1)
 *
 * Release 4 전까지 이 저장소에는 **주문 API 를 부르는 코드가 없다.** 「나중에 쓸지 모르니
 * 상수만 적어 둔다」도 안 한다 — 적어 두면 부르는 코드는 한 줄이고, 그 한 줄이 실수로 들어오는 날
 * 아무도 못 알아본다. `lib/policy/trading-no-order-guard.test.ts` 가 이 파일을 훑는다.
 */

/** 실전. 분봉 조회가 모의투자를 지원하지 않아 조회 전용 키로 여기를 쓴다(명세 §19) */
export const KIS_HOST_REAL = 'https://openapi.koreainvestment.com:9443'
/** 모의. 1-A 에서는 쓰지 않지만 환경 설정 값이 둘이라 짝을 맞춰 둔다 */
export const KIS_HOST_PAPER = 'https://openapivts.koreainvestment.com:29443'

export type KisEnv = 'real' | 'paper'

export function kisHost(env: KisEnv): string {
  return env === 'paper' ? KIS_HOST_PAPER : KIS_HOST_REAL
}

/** 접근토큰 발급. 하루 한 번꼴로 부르고, 1분에 한 번보다 자주 부르면 거부된다 */
export const KIS_TOKEN_PATH = '/oauth2/tokenP'

/** 재발급이 1분 제한에 걸렸을 때 KIS 가 주는 코드 (명세 §17.2 D-51) */
export const KIS_TOKEN_RATE_LIMIT_CODE = 'EGW00133'

/**
 * 1-A 가 부르는 조회 넷. **이 배열이 곧 「이 저장소가 KIS 에 할 수 있는 말」의 전부다.**
 *
 * 값은 공식 저장소 `koreainvestment/open-trading-api` 의
 * `examples_llm/domestic_futureoption/<기능명>/` 예제에서 읽어 맞췄다(2026-09-26 확인).
 * 예제가 아니라 기억으로 적으면 `FID_COND_MRKT_DIV_CODE` 가 `JF` 인지 `F` 인지 같은 것이 틀린다 —
 * 실제로 예제에는 **`F`(지수선물)** 로 돼 있다.
 */
export const KIS_QUOTATIONS = {
  /** 분봉조회. 실전 1회 최대 102건, 날짜·시각 인자로 이어 조회 */
  minuteChart: {
    path: '/uapi/domestic-futureoption/v1/quotations/inquire-time-fuopchartprice',
    trId: 'FHKIF03020200',
    /** 모의투자 미지원(명세 §20). 그래서 개발 환경도 실전 조회 전용 키를 쓴다 */
    paperSupported: false,
    maxRowsPerCall: 102,
  },
  /** 시세. 현재가와 미결제약정을 함께 준다 */
  price: {
    path: '/uapi/domestic-futureoption/v1/quotations/inquire-price',
    trId: 'FHMIF10000000',
    paperSupported: true,
    maxRowsPerCall: 1,
  },
  /** 시세호가. 최우선 호가로 스프레드를 기록한다 */
  askingPrice: {
    path: '/uapi/domestic-futureoption/v1/quotations/inquire-asking-price',
    trId: 'FHMIF10010000',
    paperSupported: true,
    maxRowsPerCall: 1,
  },
  /**
   * 국내휴장일조회. **선물 영역이 아니라 주식 영역에 있다** —
   * 휴장일은 시장 전체의 것이라 상품별로 나뉘지 않는다.
   *
   * 이것이 없으면 「최종거래일까지 몇 거래일 남았나」를 주말만 빼고 세게 되고,
   * 추석이 낀 해에는 실제보다 여유가 많은 것으로 보여 월물 교체가 늦는다.
   */
  holidays: {
    path: '/uapi/domestic-stock/v1/quotations/chk-holiday',
    trId: 'CTCA0903R',
    paperSupported: true,
    maxRowsPerCall: 100,
  },
  /** 기간별시세(일/주/월/년). 일봉 백필에만 쓴다 */
  dailyChart: {
    path: '/uapi/domestic-futureoption/v1/quotations/inquire-daily-fuopchartprice',
    trId: 'FHKIF03020100',
    paperSupported: true,
    maxRowsPerCall: 100,
  },
} as const

export type KisQuotationKey = keyof typeof KIS_QUOTATIONS

/** 지수선물. 옵션('O')은 이 모듈이 다루지 않는다 */
export const FID_MARKET_INDEX_FUTURES = 'F'

/** 시간 구분 코드. 30 초와 1분만 있고 5·15분은 우리가 1분을 묶어 만든다(§6.2) */
export const FID_HOUR_1M = '60'

/**
 * 종목정보 마스터. 월물 목록과 「지금 무엇이 근월물인가」가 여기 있다(명세 §20).
 *
 * KIS 조회 API 가 아니라 다운로드 서버다. 주소는 공식 저장소 예제
 * `stocks_info/domestic_index_future_code.py` 의 값이고 상수다 — 바깥 값이 안 섞인다.
 */
export const KIS_INDEX_FUTURE_MASTER_URL =
  'https://new.real.download.dws.co.kr/common/master/fo_idx_code_mts.mst.zip'

/**
 * 1-C 가 부르는 계좌 조회. **조회뿐이다** — 이 표에 주문은 없다(M1).
 *
 * TR ID 는 공식 저장소 `koreainvestment/open-trading-api` 의
 * `examples_llm/domestic_futureoption/<기능명>/<기능명>.py` 에서 읽었다(2026-09-26 확인).
 * 기억으로 적지 않는다 — 조회와 주문은 앞 네 글자가 겹친다(`TTTO5201R` 은 조회, `TTTO1101U` 는 주문).
 * **끝 글자가 갈라 준다: 조회는 `R`, 주문은 `U`.**
 *
 * 야간(파생 야간시장)은 낮과 TR 이 다르고, 공식 예제에 모의 TR 이 없다 —
 * 모의투자 계좌로는 야간 조회를 못 한다고 보고 `paperTrId: null` 로 적는다.
 */
export const KIS_ACCOUNT_QUERIES = {
  /** 선물옵션 잔고현황. 지금 무엇을 몇 장 들고 있나 */
  balance: {
    path: '/uapi/domestic-futureoption/v1/trading/inquire-balance',
    trId: 'CTFO6118R',
    paperTrId: 'VTFO6118R',
  },
  /** 선물옵션 주문체결내역조회. 체결과 미체결을 `CCLD_NCCS_DVSN` 으로 가른다 */
  fills: {
    path: '/uapi/domestic-futureoption/v1/trading/inquire-ccnl',
    trId: 'TTTO5201R',
    paperTrId: 'VTTO5201R',
  },
  /** 선물옵션 총자산현황. 예수금과 평가금 */
  deposit: {
    path: '/uapi/domestic-futureoption/v1/trading/inquire-deposit',
    trId: 'CTRP6550R',
    paperTrId: null,
  },
  /** 선물옵션 주문가능. 증거금과 주문가능 수량 */
  orderable: {
    path: '/uapi/domestic-futureoption/v1/trading/inquire-psbl-order',
    trId: 'TTTO5105R',
    paperTrId: 'VTTO5105R',
  },
  /** (야간) 선물옵션 잔고현황 */
  nightBalance: {
    path: '/uapi/domestic-futureoption/v1/trading/inquire-ngt-balance',
    trId: 'CTFN6118R',
    paperTrId: null,
  },
  /** (야간) 선물옵션 주문체결내역조회 */
  nightFills: {
    path: '/uapi/domestic-futureoption/v1/trading/inquire-ngt-ccnl',
    trId: 'STTN5201R',
    paperTrId: null,
  },
  /** (야간) 선물옵션 증거금 상세 */
  nightMargin: {
    path: '/uapi/domestic-futureoption/v1/trading/ngt-margin-detail',
    trId: 'CTFN7107R',
    paperTrId: null,
  },
} as const

export type KisAccountKey = keyof typeof KIS_ACCOUNT_QUERIES

/** 낮 조회와 밤 조회의 짝. 야간 세션이면 오른쪽을 부른다 */
export const NIGHT_EQUIVALENT: Partial<Record<KisAccountKey, KisAccountKey>> = {
  balance: 'nightBalance',
  fills: 'nightFills',
  orderable: 'nightMargin',
}

/** 체결·미체결 구분 (`CCLD_NCCS_DVSN`). 공식 예제 `inquire_ccnl` 의 값 */
export const CCLD_DVSN = { all: '00', filled: '01', open: '02' } as const

/** 매도매수 구분 (`SLL_BUY_DVSN_CD`). 00 전체 · 01 매도 · 02 매수 */
export const SLL_BUY_DVSN = { all: '00', sell: '01', buy: '02' } as const
