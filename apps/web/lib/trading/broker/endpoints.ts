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
