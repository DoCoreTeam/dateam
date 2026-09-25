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
