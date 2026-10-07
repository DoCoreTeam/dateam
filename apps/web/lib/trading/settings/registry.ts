/**
 * 설정 레지스트리 — 매매에 쓰이는 값이 **여기 말고는 없다**
 *
 * ## 왜 한곳인가 (명세 M7 · §15.1)
 *
 * 값이 코드와 화면 두 곳에 있으면 갈린다. 「하루 최대 신호 6」을 규칙이 상수로 들고
 * 설정 화면이 또 적어 두면, 관리자가 5 로 바꿔도 규칙은 6 으로 돈다 — 그리고
 * **화면은 5 라고 말한다.** 이 저장소는 그 사고를 이미 겪었다(같은 자리의 숫자가
 * 탭마다 다른 뜻이던 배지, GPU 원가 기준이 두 벌이던 일).
 *
 * 그래서 값은 여기 한 줄로 선언하고, 규칙도 화면도 이 목록을 읽는다.
 * 이 파일 밖에 매매 숫자를 적으면 `registry.test.ts` 가 잡는다.
 *
 * ## 왜 지금 안 쓰는 값까지 있나
 *
 * 명세 §19 가 「1-A 에서는 쓰이지 않음(1-C)」이라고 적어 둔 값들이 있다 —
 * 일일 손실 한도·수수료율 같은 것이다. 선언만 하고 소비하는 코드가 없는 값은
 * 나중에 「이거 쓰는 데 있나」를 찾게 만든다(실측 전례: 선언만 되고 소비 코드가
 * 0 이던 ENRICH 종류). 그래서 값마다 `usedFrom` 을 적는다 —
 * **언제부터 쓰는지가 값 옆에 있으면 찾을 필요가 없다.**
 *
 * ## 여기 없는 것
 *
 * **비밀값이 없다.** KIS 앱키·시크릿·계좌번호는 설정이 아니라 자격증명이고,
 * 암호화한 채로 `trading_broker_credentials` 에만 있다. 설정은 화면에 그대로 뜨는
 * 값이라 비밀이 섞이면 그날로 새어 나간다.
 */

import { NOT_MEASURED } from '../../terms/index.ts'
import { AI_PROVIDERS, openAiCompatibleBaseUrl } from '../../ai/provider-catalog.ts'

/**
 * 판단을 부를 수 있는 공급자 — **문이 있는 것만**.
 *
 * 공식 SDK 로만 말하는 공급자는 여기 안 온다. 판단 호출은 JSON 한 번이라 OpenAI 호환
 * 창구로 가고, 그 문이 없으면 `createServerJevJudge` 가 판단기를 아예 안 만든다.
 * 목록을 손으로 적지 않는 이유: 공급자를 하나 늘린 날 그 사본이 안 따라온다.
 */
export const JUDGE_PROVIDERS: readonly string[] = AI_PROVIDERS
  .filter((p) => openAiCompatibleBaseUrl(p.id) !== null)
  .map((p) => p.id)

/** 값 하나가 어느 묶음에 속하나. 설정 화면의 절이 이 순서로 선다 */
export type TradingSettingGroup =
  | 'basic'      // 기본
  | 'instrument' // 상품·세션
  | 'decision'   // 판단
  | 'collect'    // 수집
  | 'broker'     // 증권사 연결
  | 'risk'       // 일일 한도
  | 'replay'     // 체결 재현
  | 'validation' // 검증
  | 'signal'     // 신호 규칙
  | 'safety'     // 안전 게이트 (기준값만, 끄는 설정은 없다)
  | 'exit'       // 청산
  | 'notify'     // 알림
  | 'knowledge'  // 지식과 설명
  | 'operator'   // AI 운영자
  | 'autoorder'  // 자동 주문 (Release 4)

/** 언제부터 이 값을 실제로 읽나. 「선언만 되고 아무도 안 읽는 값」을 없애려고 적는다 */
export type UsedFrom = '1-A' | '1-B' | '1-C'

export type TradingSettingValue = string | number | boolean

export interface TradingSetting {
  /** `trading_settings.key` 에 그대로 들어간다 */
  key: string
  group: TradingSettingGroup
  /** 설정 화면에 그릴 이름 */
  label: string
  /** 무엇을 정하는 값인지 한 줄. 이름만으로는 왜 그 값인지 모른다 */
  help: string
  type: 'string' | 'number' | 'boolean' | 'choice'
  /** `type` 이 choice 일 때 고를 수 있는 값 */
  choices?: readonly string[]
  /** 명세 §19 의 초기값. DB 에 아무 판도 없을 때 쓰는 값이다 */
  defaultValue: TradingSettingValue
  /** 초 · 분 · 원 같은 단위. 화면이 숫자 옆에 그린다 */
  unit?: string
  usedFrom: UsedFrom
  /** 명세의 어느 절에서 온 값인가. 근거 없는 숫자를 못 넣게 한다 */
  source: string
  min?: number
  max?: number
}

/**
 * 등록된 설정 전부.
 *
 * 순서가 곧 설정 화면의 순서다. 묶음끼리 붙여 적는다.
 */
export const TRADING_SETTINGS: readonly TradingSetting[] = [
  // ── 기본 ────────────────────────────────────────────────
  {
    key: 'owner_user_id',
    group: 'basic',
    label: '소유자',
    help: '이 화면을 볼 수 있는 단 한 사람입니다',
    type: 'string',
    // 비어 있으면 아무도 못 들어간다 — 열어 두는 것보다 닫아 두고 시작하는 쪽이 맞다
    defaultValue: '',
    usedFrom: '1-A',
    source: '명세 §14.5 · M11',
  },
  {
    key: 'calibration_version',
    group: 'basic',
    label: '보정 모델 판',
    help: '어느 판의 보정 모델을 쓸지 정합니다. 비우면 판을 안 가립니다',
    type: 'string',
    defaultValue: '',
    usedFrom: '1-C',
    source: '명세 §10.1 SG-08 · M3',
  },
  {
    key: 'ev_model_version',
    group: 'basic',
    label: '기대 수익 모델 판',
    help: '어느 판의 기대 수익표를 쓸지 정합니다. 비우면 최신 판을 씁니다',
    type: 'string',
    defaultValue: '',
    usedFrom: '1-C',
    source: '명세 §7.5',
  },
  {
    key: 'ev_min_bucket_samples',
    group: 'basic',
    label: '기대 수익 최소 표본',
    help: '표본이 이만큼은 있어야 그 구간의 평균을 씁니다',
    type: 'number',
    defaultValue: 1,
    unit: '건',
    min: 1,
    max: 1000,
    usedFrom: '1-C',
    source: '명세 §7.5 · §13.4',
  },
  {
    /**
     * 현황이 스스로 다시 읽는 간격.
     *
     * **env 로 안 둔다.** 값을 바꾸려고 배포를 기다려야 하면 아무도 안 바꾼다.
     * 0 을 허용하지 않는 이유: 0 은 「안 읽음」과 「쉬지 않고 읽음」 둘 다로 읽힌다 —
     * 끄고 싶으면 상한 쪽으로 올린다.
     */
    /** 가격은 별도 스트림이 받고, 이 값은 판단·성적·계보를 포함한 전체 화면 재조회만 맡는다. */
    key: 'overview_refresh_seconds',
    group: 'basic',
    label: '현황 새로 읽는 간격',
    help: '판단과 성적 등 현황 전체를 다시 읽는 간격입니다. 현재가는 따로 실시간으로 받습니다',
    type: 'number',
    defaultValue: 30,
    unit: '초',
    min: 5,
    max: 600,
    usedFrom: '1-A',
    source: '사용자 지적 2026-09-28 「실시간으로 보여지는 화면 형태여야」 · 2026-10-01 현재가 스트림 분리',
  },
  {
    key: 'price_push_seconds',
    group: 'basic',
    label: '현재가 받는 간격',
    help: '열어 둔 현황 화면이 현재가를 받아 형성 중인 봉을 움직이는 간격입니다',
    type: 'number',
    defaultValue: 1,
    unit: '초',
    min: 1,
    max: 10,
    usedFrom: '1-A',
    source: '사용자 지적 2026-10-01 「봉이 안 움직인다」',
  },
  {
    key: 'decision_spec_version',
    group: 'basic',
    label: '판단 규칙 판',
    help: '판단마다 함께 적는 규칙 번호입니다. 규칙을 바꾸면 올립니다',
    type: 'string',
    defaultValue: 'v1',
    usedFrom: '1-A',
    source: '명세 §14.1',
  },

  // ── 상품·세션 ───────────────────────────────────────────
  {
    key: 'instrument_root',
    group: 'instrument',
    label: '상품',
    help: '신호를 낼 상품을 정합니다',
    type: 'choice',
    choices: ['MINI_KOSPI200', 'KOSPI200'],
    defaultValue: 'MINI_KOSPI200',
    usedFrom: '1-A',
    source: '명세 §19 「상품」',
  },
  {
    key: 'front_contract_code_override',
    group: 'instrument',
    label: '월물 코드 직접 지정',
    help: '증권사에서 월물을 못 받았을 때 대신 쓸 코드입니다',
    type: 'string',
    defaultValue: '',
    usedFrom: '1-A',
    source: '명세 §20 「종목 정보」',
  },
  {
    key: 'rollover_min_volume',
    group: 'instrument',
    label: '월물 교체 판정 최소 거래량',
    help: '두 월물의 지난 거래일 거래량 합이 이보다 적으면 교체를 판정하지 않습니다',
    type: 'number',
    defaultValue: 1000,
    unit: '계약',
    min: 1,
    max: 1000000,
    usedFrom: '1-A',
    source: '실측 2026-10-02 자정 누적 거래량 0 대 1 로 월물이 바뀌어 봉이 하루 0건',
  },
  {
    key: 'rollover_days_before_last',
    group: 'instrument',
    label: '월물 교체 기한',
    help: '교체는 거래량이 정합니다. 안 넘어와도 만기 이만큼 전에는 바꿉니다',
    type: 'number',
    /*
      **3 이면 거래가 안 넘어온 월물로 이틀을 보낸다.** 실측 2026-10-07: 10-05 자정에
      「10-08 까지 3 거래일」로 걸려 10월물(10-02 거래량 121,719)을 두고 11월물(913)로 갈아탔다.
      이틀 뒤 그날 거래량은 10월물 112,701 대 11월물 5,036 이었다 — 22배 차이다.
      미니 코스피200 은 월물이 매달 있어 거래가 만기 직전에야 넘어온다. 그래서 보루는 하루다
    */
    defaultValue: 1,
    unit: '거래일',
    min: 1,
    max: 10,
    usedFrom: '1-A',
    source: '명세 §6.3, 실측 2026-10-07 거래량 112,701 대 5,036',
  },
  {
    key: 'collect_night_session',
    group: 'instrument',
    label: '야간장 수집',
    help: '야간장 시세도 모읍니다. 신호는 정규장에만 냅니다',
    type: 'boolean',
    defaultValue: true,
    usedFrom: '1-A',
    source: '명세 §6.1 「야간장도 수집한다(신호는 정규장만)」',
  },
  {
    key: 'night_trade_date_rule',
    group: 'instrument',
    label: '야간장 날짜 기준',
    help: '저녁에 시작한 장을 어느 날의 거래로 셀지 정합니다',
    type: 'choice',
    choices: ['next', 'same'],
    defaultValue: 'next',
    usedFrom: '1-A',
    source: '명세 §6.4 (거래소 기준 확인 후 조정)',
  },
  {
    key: 'session_close_exit_minutes',
    group: 'instrument',
    label: '당일 청산 알림 여유',
    help: '접속매매 종료에서 이 분을 뺀 시각이 당일 청산 시각이다. 고정 시각이 아니다',
    type: 'number',
    defaultValue: 15,
    unit: '분',
    min: 1,
    max: 120,
    usedFrom: '1-A',
    source: '명세 §19 「당일 청산 알림 N」',
  },

  // ── 판단 ────────────────────────────────────────────────
  {
    key: 'decision_tf',
    group: 'decision',
    label: '판단 봉',
    help: '몇 분짜리 봉이 끝날 때마다 판단할지 정합니다',
    type: 'choice',
    choices: ['1m', '5m', '15m'],
    defaultValue: '1m',
    usedFrom: '1-A',
    source: '명세 §19 「판단 봉」',
  },
  {
    key: 'min_hold_minutes',
    group: 'decision',
    label: '최소 보유 시간',
    help: '신호를 받고 들어가서 이 정도는 들고 있을 만한 길이로 잡습니다',
    type: 'number',
    defaultValue: 15,
    unit: '분',
    min: 1,
    max: 240,
    usedFrom: '1-A',
    source: '명세 §19 「보유 기준」',
  },
  {
    key: 'jev_provider',
    group: 'decision',
    label: 'AI 판단을 어디에 맡길까',
    /**
     * **「Jev」를 설명 없이 쓰지 않는다** (사용자 질문 2026-09-28
     * 「jev에도 모델명이 있다고? 나는 잘 모르는 이야긴데 그냥 jev 자체 아닌가?」).
     *
     * 이 저장소에서 Jev 는 **AI 판단기의 이름**인데 공급자 목록에도 같은 낱말이 있다
     * (Vercel 관문). 같은 낱말이 두 뜻이면 화면만 읽어서는 무엇을 정하는 값인지 알 수 없다.
     */
    help: 'AI 에게 방향을 물을 때 어디 모델을 쓸지 정합니다. Jev 는 여러 곳을 잇는 관문입니다',
    type: 'choice',
    /**
     * **목록을 손으로 안 적는다.** 판단을 부를 문(OpenAI 호환 창구)이 있는 공급자만 나온다.
     * 사본을 적어 두면 공급자를 하나 늘린 날 이 줄이 안 따라오고, 화면에는 멀쩡한 공급자가
     * 영영 안 보인다 — 이 저장소가 같은 함정에 여러 번 빠졌다.
     */
    choices: JUDGE_PROVIDERS,
    defaultValue: 'jev',
    usedFrom: '1-A',
    source: '명세 §7.2 판단기는 교체 가능 · §17.1 기존 AI 계층',
  },
  {
    key: 'jev_model',
    group: 'decision',
    label: 'AI 판단에 쓸 모델',
    help: '위에서 고른 곳의 모델입니다. 관문이면 google/gemini-2.5-flash 처럼 씁니다',
    type: 'string',
    // 기본값을 안 정한다. 관문 뒤 모델 이름은 벤더가 수시로 바꾸고, 박아 두면 사라진 날 조용히 404 가 난다
    defaultValue: '',
    usedFrom: '1-A',
    source: '명세 §4 · §17.1 (Jev 호출)',
  },
  {
    key: 'atr_period',
    group: 'decision',
    label: '변동성 측정 기간',
    help: '변동성을 몇 개의 봉으로 재는지 정합니다',
    type: 'number',
    defaultValue: 14,
    unit: '봉',
    min: 2,
    max: 120,
    usedFrom: '1-A',
    source: '명세 §8 (지표 기간, 1-B 에서 비교)',
  },
  {
    key: 'sma_fast_period',
    group: 'decision',
    label: '단기 이동평균',
    help: '교차를 볼 때 빠른 쪽의 봉 수입니다',
    type: 'number',
    defaultValue: 5,
    unit: '봉',
    min: 2,
    max: 120,
    usedFrom: '1-A',
    source: '명세 §7.1 진입 조건',
  },
  {
    key: 'sma_slow_period',
    group: 'decision',
    label: '장기 이동평균',
    help: '교차를 볼 때 느린 쪽의 봉 수입니다',
    type: 'number',
    defaultValue: 20,
    unit: '봉',
    min: 3,
    max: 240,
    usedFrom: '1-A',
    source: '명세 §7.1 진입 조건',
  },
  {
    key: 'breakout_period',
    group: 'decision',
    label: '돌파 기준 봉 수',
    help: '직전 이만큼의 고가나 저가를 넘으면 돌파로 봅니다',
    type: 'number',
    defaultValue: 20,
    unit: '봉',
    min: 2,
    max: 240,
    usedFrom: '1-A',
    source: '명세 §7.1 진입 조건',
  },
  {
    key: 'breakout_atr_multiple',
    group: 'decision',
    label: '돌파 최소 폭',
    help: '변동성의 몇 배를 넘어야 돌파로 칠지 정합니다',
    type: 'number',
    defaultValue: 0.1,
    unit: 'ATR',
    min: 0,
    max: 3,
    usedFrom: '1-A',
    source: '명세 §7.1 진입 조건',
  },
  {
    key: 'jev_timeout_seconds',
    group: 'decision',
    label: '판단 대기 시간',
    help: '이 시간을 넘으면 그 판단은 건너뜁니다',
    type: 'number',
    defaultValue: 10,
    unit: '초',
    min: 1,
    max: 30,
    usedFrom: '1-A',
    source: '명세 §19 「Jev 대기 시간」 · D-41',
  },
  {
    key: 'jev_reasoning_effort',
    group: 'decision',
    label: 'AI 가 얼마나 생각할까',
    /**
     * **이 값이 대기 시간을 먹는다.**
     *
     * 실측 2026-09-28: 같은 판단 프롬프트에 생각 깊이를 안 정하면 관문이 19.7~21.5초를
     * 쓰는데 그중 출력 3,290토큰 중 3,254개가 생각이었다. 대기 시간은 20초였고,
     * 관문은 22건 전부 답했는데 우리 쪽 기록에는 다섯 건이 `timeout` 으로 남았다 —
     * **답이 오는 중에 우리가 끊은 것**이다.
     *
     * 깊이를 낮추면 그 시간이 줄어든다 (low 9.9초 · none 1.7초). 대신 판단이 달라진다 —
     * 같은 입력에 생각한 판은 0.85/0.05/0.10 을, 안 한 판은 0.7/0.1/0.2 를 줬다.
     * 그래서 코드가 정하지 않고 운영자가 정한다.
     */
    help: '깊게 생각할수록 답이 늦습니다. 대기 시간을 넘기면 그 판단은 버려집니다',
    type: 'choice',
    /**
     * **관문이 받는 값 그대로다.** 실측 2026-09-28: 목록에 없는 값을 보내면 관문이 400 으로
     * 거절하며 `expected one of "none"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"` 라고
     * 답한다. 화면에서 고를 수 있는데 관문이 거절하는 값이 있으면 그 판단은 통째로 사라진다.
     *
     * 생각을 안 하는 모델(`openai/gpt-4o-mini` · `alibaba/qwen3-coder`)에 실어 보내도
     * 관문이 조용히 무시하고 200 을 준다 — 모델을 골라 가며 붙일 필요가 없다.
     */
    choices: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    /**
     * `low` 다. 실측 9.9초라 대기 시간 20초 안에 여유가 있고, 생각을 아예 끄지는 않는다.
     * 기본을 `none` 으로 두면 빠르긴 하지만 운영자가 모르는 새 판단 성격이 바뀐다.
     */
    defaultValue: 'low',
    usedFrom: '1-A',
    source: '명세 §19 「Jev 대기 시간」 · D-41 (관문 실측 2026-09-28)',
  },

  // ── 수집 ────────────────────────────────────────────────
  {
    key: 'bar_grace_seconds',
    group: 'collect',
    label: '시세 확정 여유',
    help: '봉이 끝나고 이 시간이 지나면 확정된 것으로 봅니다',
    type: 'number',
    defaultValue: 10,
    unit: '초',
    min: 1,
    max: 55,
    usedFrom: '1-A',
    source: '명세 §19 · §6.2 graceSec',
  },
  {
    key: 'bar_retry_count',
    group: 'collect',
    label: '시세 재조회 횟수',
    help: '시세가 안 왔을 때 같은 분 안에서 몇 번 더 물어볼지 정합니다',
    type: 'number',
    defaultValue: 2,
    unit: '회',
    min: 0,
    max: 5,
    usedFrom: '1-A',
    source: '명세 §6.2 의사코드 retryLater',
  },
  {
    key: 'bar_retry_delay_ms',
    group: 'collect',
    label: '시세 재조회 간격',
    help: '다시 물어보기 전에 이만큼 쉽니다',
    type: 'number',
    defaultValue: 3000,
    unit: 'ms',
    min: 0,
    max: 20000,
    usedFrom: '1-A',
    source: '명세 §6.2 의사코드 retryLater',
  },
  {
    key: 'bar_missing_after_seconds',
    group: 'collect',
    label: '시세 결측 기준',
    help: '이 시간까지 안 오면 그 분의 판단을 건너뜁니다',
    type: 'number',
    defaultValue: 25,
    unit: '초',
    min: 5,
    max: 55,
    usedFrom: '1-A',
    source: '명세 §19 · §6.2 missingAfterSec',
  },

  // ── 증권사 연결 ─────────────────────────────────────────
  {
    key: 'kis_env',
    group: 'broker',
    label: '증권사 환경',
    help: '실전 계좌로 조회할지 모의 계좌로 조회할지 정합니다',
    type: 'choice',
    choices: ['real', 'paper'],
    defaultValue: 'real',
    usedFrom: '1-A',
    source: '명세 §19 「개발 환경 KIS 키」',
  },
  {
    key: 'kis_min_interval_ms',
    group: 'broker',
    label: '증권사 호출 최소 간격',
    help: '증권사에 이 간격보다 촘촘하게 묻지 않습니다',
    type: 'number',
    defaultValue: 200,
    unit: 'ms',
    min: 50,
    max: 5000,
    usedFrom: '1-A',
    source: '명세 §19 「KIS 호출 최소 간격」 · §20',
  },
  {
    key: 'kis_token_refresh_margin_minutes',
    group: 'broker',
    label: '증권사 인증 갱신 여유',
    help: '만료까지 이만큼 남기 전에는 인증을 다시 받지 않습니다',
    type: 'number',
    defaultValue: 30,
    unit: '분',
    min: 5,
    max: 120,
    usedFrom: '1-A',
    source: '명세 §17.2 D-51',
  },

  // ── 일일 한도 ───────────────────────────────────────────
  {
    /**
     * 실제 1회 위험은 신호마다 ATR 과 손절가로 **계산한다**(§9.1).
     * 이 값은 신호가 아직 없을 때 무장 관문(A6)이 보는 **가정값**이다 —
     * 0 이면 「모른다」라서 관문이 막는다. 실측 2026-09-26: 이 키를 읽는 코드는
     * 있는데 등록부에 없어서 화면에서 고칠 수 없었다
     */
    key: 'risk_per_trade_krw',
    group: 'risk',
    label: '1회 위험 가정값',
    help: '자동 주문을 켤 수 있는지 볼 때 쓰는 기준 금액입니다',
    type: 'number',
    defaultValue: 0,
    unit: '원',
    min: 0,
    usedFrom: '1-C',
    source: '명세 §9.1 · 설계 §2 A6',
  },
  {
    /**
     * **성적을 「얼마 넣으면 얼마 버나」로 옮기는 기준.**
     *
     * 사용자 지적 2026-09-29: 「금액은 내가 잘 모르는데 투자하는 기준금액이 있는거 같은데
     * 그렇게 표시 하면 안되나?」 — 화면에 「+714,660원」만 있으면 그것이 1계약인지
     * 열 계약인지, 얼마를 넣어 얻은 것인지 알 수 없다.
     *
     * 0 이면 **미설정**이고 수익률 자리를 비운다. 0 을 기준으로 나누면 무한대가 되고,
     * 임의로 기본값을 넣으면 화면이 사용자가 정하지 않은 수익률을 말하게 된다.
     */
    key: 'account_base_krw',
    group: 'risk',
    label: '투자 기준금액',
    help: '이 돈을 넣었다고 보고 수익률을 셉니다. 0이면 수익률 대신 금액만 보여드립니다',
    type: 'number',
    defaultValue: 0,
    unit: '원',
    min: 0,
    usedFrom: '1-B',
    source: '사용자 지시 2026-09-29 (성적을 기준금액 대비로)',
  },
  {
    key: 'daily_loss_limit_krw',
    group: 'risk',
    label: '일일 손실 한도',
    help: '하루에 여기까지만 잃습니다',
    type: 'number',
    defaultValue: 500000,
    unit: '원',
    min: 0,
    usedFrom: '1-C',
    source: '명세 §19 「일일 손실 한도」',
  },
  {
    key: 'daily_target_krw',
    group: 'risk',
    label: '일일 목표',
    help: '오늘 수익이 여기에 닿으면 새 신호를 멈춥니다',
    type: 'number',
    defaultValue: 300000,
    unit: '원',
    min: 0,
    usedFrom: '1-C',
    source: '명세 §19 「일일 목표」',
  },

  // ── 검증 관문 (§13.5) ───────────────────────────────────
  {
    key: 'validation_fold_count',
    group: 'validation',
    label: '워크포워드 접는 수',
    help: '학습·검증을 몇 번 굴릴 것인가. 한 번만 하면 검증 구간이 딱 한 장뿐입니다',
    type: 'number',
    defaultValue: 3,
    unit: '겹',
    min: 1,
    max: 20,
    usedFrom: '1-B',
    source: '명세 §13.3',
  },
  {
    key: 'validation_validate_days',
    group: 'validation',
    label: '검증 한 구간 길이',
    help: '한 구간이 평가하는 거래일 수입니다',
    type: 'number',
    defaultValue: 10,
    unit: '거래일',
    min: 1,
    usedFrom: '1-B',
    source: '명세 §13.3',
  },
  {
    key: 'validation_min_train_days',
    group: 'validation',
    label: '최소 학습 길이',
    help: '이보다 짧은 학습으로는 보정을 맞추지 않습니다',
    type: 'number',
    defaultValue: 30,
    unit: '거래일',
    min: 5,
    usedFrom: '1-B',
    source: '명세 §13.3',
  },
  {
    key: 'validation_embargo_days',
    group: 'validation',
    label: '학습과 검증 사이 띄울 날',
    /**
     * **붙여 두면 성적이 부풀려진다.**
     *
     * 라벨은 진입 뒤 손절·목표·시간청산 중 무엇이 먼저 닿았나다. 학습 마지막 날 늦게 연
     * 거래는 그 날 안에 안 끝날 수 있고, 붙어 있으면 그 결과가 검증 첫날 가격으로 정해진다.
     * 실측 2026-09-29 점검: 이 값이 없어 하루도 안 띄우고 있었다.
     */
    help: '이만큼은 학습에도 검증에도 안 씁니다. 붙여 두면 경계에 걸친 거래가 성적을 부풀립니다',
    type: 'number',
    defaultValue: 1,
    unit: '거래일',
    min: 0,
    max: 10,
    usedFrom: '1-B',
    source: '명세 §13.3 워크포워드 (점검 2026-09-29)',
  },
  {
    key: 'validation_lockbox_days',
    group: 'validation',
    label: '최종 검증 길이',
    help: '마지막에 떼어 두는 거래일 수. 한 번만 열 수 있습니다',
    type: 'number',
    defaultValue: 20,
    unit: '거래일',
    min: 5,
    usedFrom: '1-B',
    source: '명세 §13.3',
  },
  {
    key: 'validation_seed',
    group: 'validation',
    label: '부트스트랩 씨앗',
    help: '같은 씨앗에 같은 신뢰구간이 나옵니다. 어제 통과하고 오늘 아닌 숫자는 쓸 수 없습니다',
    type: 'number',
    defaultValue: 1,
    min: 0,
    usedFrom: '1-B',
    source: '명세 §13.4',
  },
  {
    key: 'calibration_isotonic_min_samples',
    group: 'validation',
    label: '등위 회귀 최소 표본',
    help: '이만큼 모여야 등위 회귀를 후보로 봅니다. 적으면 훈련 자료를 외웁니다',
    type: 'number',
    defaultValue: 1000,
    unit: '건',
    min: 100,
    usedFrom: '1-B',
    source: '명세 §7.4 (D-42)',
  },
  {
    key: 'replay_delay_minutes',
    group: 'replay',
    label: '체결 재현 지연',
    help: '신호에서 주문까지 걸린다고 가정하는 시간. 1-C 부터 실제 기록으로 바꿉니다',
    type: 'number',
    defaultValue: 2,
    unit: '분',
    min: 0,
    max: 30,
    usedFrom: '1-B',
    source: '명세 §13.2 · C3',
  },
  {
    key: 'replay_fallback_ticks',
    group: 'replay',
    label: '호가 없을 때 가정 슬리피지',
    help: '호가를 못 받은 시세에 대신 쓸 틱 수입니다',
    type: 'number',
    defaultValue: 2,
    unit: '틱',
    min: 0,
    max: 20,
    usedFrom: '1-B',
    source: '명세 §13.2',
  },
  {
    key: 'exit_stop_atr_multiple',
    group: 'decision',
    label: '손절 거리',
    help: '변동성의 몇 배 거리에 손절을 둘지 정합니다',
    type: 'number',
    defaultValue: 1.2,
    unit: 'ATR',
    min: 0.1,
    max: 10,
    usedFrom: '1-B',
    source: '명세 §8',
  },
  {
    key: 'exit_target_atr_multiple',
    group: 'decision',
    label: '목표 거리',
    help: 'ATR 의 몇 배를 목표로 둘 것인가. 목표는 하나입니다',
    type: 'number',
    defaultValue: 1.5,
    unit: 'ATR',
    min: 0.1,
    max: 10,
    usedFrom: '1-B',
    source: '명세 §8',
  },
  {
    key: 'exit_chase_atr_multiple',
    group: 'decision',
    label: '진입 한계 거리',
    help: '이만큼 넘어서면 따라가지 않습니다. 롱은 위쪽, 숏은 아래쪽입니다',
    type: 'number',
    defaultValue: 0.3,
    unit: 'ATR',
    min: 0,
    max: 5,
    usedFrom: '1-B',
    source: '명세 §8',
  },
  {
    key: 'gate_min_validate_trades',
    group: 'validation',
    label: '관문 최소 거래 수',
    help: `검증 구간 합계가 이만큼은 돼야 기대값을 믿을 수 있습니다. 적으면 미달이 아니라 ${NOT_MEASURED}입니다`,
    type: 'number',
    defaultValue: 500,
    unit: '건',
    min: 50,
    usedFrom: '1-B',
    source: '명세 §13.5 · §13.4 (표본 크기 감각)',
  },
  {
    key: 'gate_min_lockbox_trades',
    group: 'validation',
    label: '최종 검증 최소 거래 수',
    type: 'number',
    help: '최종 검증 구간에서 이만큼은 나와야 마지막 확인이 뜻을 갖습니다',
    defaultValue: 100,
    unit: '건',
    min: 20,
    usedFrom: '1-B',
    source: '명세 §13.5 (D-44)',
  },
  {
    key: 'gate_min_profit_factor',
    group: 'validation',
    label: '관문 Profit Factor',
    help: '번 것 ÷ 잃은 것이 이만큼은 돼야 합니다',
    type: 'number',
    defaultValue: 1.25,
    min: 1,
    usedFrom: '1-B',
    source: '명세 §13.5',
  },
  {
    key: 'gate_max_drawdown_multiple',
    group: 'validation',
    label: '최대 낙폭 상한',
    help: '일일 손실 한도의 몇 배까지 견딜 것인가. 넘으면 평균이 좋아도 사람이 먼저 그만둡니다',
    type: 'number',
    defaultValue: 8,
    unit: '배',
    min: 1,
    max: 50,
    usedFrom: '1-B',
    source: '명세 §13.5',
  },
  {
    key: 'signal_requires_jev',
    group: 'decision',
    label: '판단 모델 없이 신호 내기',
    help: '켜면 판단 모델이 답하지 않은 날에도 규칙만으로 신호를 냅니다',
    type: 'choice',
    choices: ['true', 'false'],
    defaultValue: 'true',
    usedFrom: '1-C',
    source: '명세 §7.2 판단기 · §13.5 관문',
  },
  {
    key: 'validation_jev_max_calls',
    group: 'decision',
    label: '검증 때 모델 호출 상한',
    help: '검증 한 번에 판단 모델을 몇 번까지 부를지 정합니다',
    type: 'number',
    defaultValue: 0,
    unit: '회',
    min: 0,
    max: 2000,
    usedFrom: '1-B',
    source: '명세 §13.4 판단기 비교 · §17.1 (예산은 기존 AI 계층)',
  },
  {
    key: 'gate_min_judge_improvement_r',
    group: 'validation',
    label: '판단기 최소 개선폭',
    help: '다른 판단기보다 이만큼은 나아야 낫다고 말합니다. 하한만 보면 +0.001R 로도 낫다고 하게 됩니다',
    type: 'number',
    defaultValue: 0.05,
    unit: 'R',
    min: 0,
    usedFrom: '1-B',
    source: '명세 §13.4',
  },

  // ── 체결 재현 ───────────────────────────────────────────
  {
    key: 'replay_order_type',
    group: 'replay',
    label: '주문 방식 가정',
    help: '검증에서 가정하는 주문 방식입니다. 실제 주문은 사람이 합니다',
    type: 'choice',
    choices: ['market', 'limit'],
    defaultValue: 'market',
    usedFrom: '1-B',
    source: '명세 §19 「주문 방식(체결 재현용)」',
  },
  {
    /**
     * **편도 수수료율(%).** 선물 수수료는 약정금액(지수 × 승수)에 비례한다 —
     * 정액으로 두면 지수가 움직일 때 비용이 안 따라간다.
     *
     * 기본값 근거(2026-09-29 한국투자증권 공개 요율 확인):
     *   · 뱅키스(제휴은행 개설) 온라인 KOSPI200·미니KOSPI200 0.00185%
     *   · 영업점 계좌 KOSPI200·미니KOSPI200·KRX300 0.009811%
     * 계좌 경로에 따라 다섯 배가 넘게 갈리므로 **화면에서 고르게 둔다**.
     */
    key: 'fee_percent_per_side',
    group: 'replay',
    label: '수수료율 (편도)',
    help: '약정금액 대비 %입니다. 뱅키스 온라인은 0.00185 입니다',
    type: 'number',
    defaultValue: 0.00185,
    unit: '%',
    min: 0,
    max: 1,
    usedFrom: '1-B',
    source: '한국투자증권 공개 요율 2026-09-29 확인 (뱅키스 온라인 0.00185% · 영업점 0.009811%, 유관기관제비용 별도) · 명세 §19',
  },
  {
    /**
     * **요율로 안 잡히는 고정 비용.** 유관기관제비용(거래소·예탁결제원)은
     * 위 위탁수수료와 **별도**로 붙는다.
     *
     * 이름이 「수수료율」이었는데 쓰이는 자리에서는 정액(원)이었다 —
     * 요율을 믿고 0.00185 를 넣으면 왕복 수수료가 0.00185원이 됐다. 이름을 뜻에 맞췄다.
     */
    key: 'fee_rate',
    group: 'replay',
    label: '그 밖의 고정 비용 (왕복)',
    help: '요율로 안 잡히는 비용을 원으로 넣습니다',
    type: 'number',
    defaultValue: 0,
    unit: '원',
    min: 0,
    usedFrom: '1-B',
    source: '명세 §19 「수수료율」 (2026-09-29 뜻을 정액으로 못박음)',
  },
  {
    key: 'kis_account_product_code',
    group: 'broker',
    label: '계좌상품코드',
    help: '계좌번호 뒤 두 자리입니다. 선물옵션은 보통 03 입니다',
    type: 'choice',
    choices: ['03', '01', '02'],
    defaultValue: '03',
    usedFrom: '1-C',
    source: '공식 예제 domestic_futureoption/inquire_balance (ex. 03)',
  },

  // ── 신호 규칙 (§7.6) ────────────────────────────────────
  //
  // 규칙은 값을 인자로 받는다. 값이 코드에 박히면 설정 화면과 규칙이 다른 숫자를 보게 되고,
  // 그때 화면은 아무 말도 안 한다 — 「바꿨는데 안 바뀐다」가 된다.
  {
    key: 'signal_min_net_ev_r',
    group: 'signal',
    label: '최소 기대 수익',
    help: '비용을 뺀 기대 수익이 이보다 작으면 신호를 내지 않습니다',
    type: 'number',
    defaultValue: 0.1,
    unit: 'R',
    min: 0,
    max: 5,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-01',
  },
  {
    key: 'signal_min_enter_now_prob',
    group: 'signal',
    label: '최소 진입 확률',
    help: '진입 확률이 이보다 낮으면 신호를 내지 않습니다',
    type: 'number',
    defaultValue: 0.55,
    min: 0,
    max: 1,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-02',
  },
  {
    key: 'signal_opening_block_minutes',
    group: 'signal',
    label: '개장 직후 대기',
    help: '개장하고 이 시간 동안은 신호를 내지 않습니다',
    type: 'number',
    defaultValue: 5,
    unit: '분',
    min: 0,
    max: 120,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-04',
  },
  {
    key: 'signal_closing_block_minutes',
    group: 'signal',
    label: '마감 전 중단',
    help: '마감까지 이만큼 남으면 새 신호를 내지 않습니다',
    type: 'number',
    defaultValue: 30,
    unit: '분',
    min: 0,
    max: 240,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-04',
  },
  {
    key: 'signal_event_block_before_minutes',
    group: 'signal',
    label: '일정 전 중단',
    help: '등록한 일정 이만큼 전부터 신호를 내지 않습니다',
    type: 'number',
    defaultValue: 30,
    unit: '분',
    min: 0,
    max: 240,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-05',
  },
  {
    key: 'signal_event_block_after_minutes',
    group: 'signal',
    label: '일정 후 대기',
    help: '일정이 지나고 이 시간 동안은 신호를 내지 않습니다',
    type: 'number',
    defaultValue: 15,
    unit: '분',
    min: 0,
    max: 240,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-05',
  },
  {
    key: 'signal_cooldown_after_losses',
    group: 'signal',
    label: '연속 손실 기준',
    help: '이만큼 연달아 손해를 보면 잠시 쉽니다',
    type: 'number',
    defaultValue: 2,
    unit: '회',
    min: 1,
    max: 10,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-08',
  },
  {
    key: 'signal_cooldown_minutes',
    group: 'signal',
    label: '연속 손실 후 휴식',
    help: '연속 손실 뒤 이 시간 동안 새 신호를 내지 않습니다',
    type: 'number',
    defaultValue: 60,
    unit: '분',
    min: 0,
    max: 480,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-08',
  },
  {
    key: 'signal_max_per_day',
    group: 'signal',
    label: '하루 최대 신호',
    help: '하루에 이보다 많은 신호를 내지 않습니다',
    type: 'number',
    defaultValue: 6,
    unit: '건',
    min: 1,
    max: 50,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-09',
  },
  {
    key: 'signal_same_direction_gap_minutes',
    group: 'signal',
    label: '같은 방향 재신호 간격',
    help: '같은 방향으로 다시 신호를 내기까지 기다리는 시간입니다',
    type: 'number',
    defaultValue: 10,
    unit: '분',
    min: 0,
    max: 240,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-10',
  },
  {
    key: 'signal_min_target_cost_multiple',
    group: 'signal',
    label: '목표 대비 최소 수익폭',
    help: '목표까지 거리가 왕복 수수료의 이 배수는 돼야 합니다',
    type: 'number',
    defaultValue: 3,
    unit: '배',
    min: 1,
    max: 20,
    usedFrom: '1-C',
    source: '명세 §7.6 SR-12',
  },

  // ── 안전 게이트 (§10.1) ─────────────────────────────────
  //
  // **기준값만 있고 끄는 설정은 없다.** 게이트를 끌 수 있으면 언젠가 꺼 놓은 채로 돈다.
  {
    key: 'gate_spread_abnormal_multiple',
    group: 'safety',
    label: '호가 폭 이상 기준',
    help: '호가 폭이 평소의 이 배수를 넘으면 신호를 멈춥니다',
    type: 'number',
    defaultValue: 3,
    unit: '배',
    min: 2,
    max: 20,
    usedFrom: '1-C',
    source: '명세 §10.1 SG-01',
  },
  {
    key: 'gate_bar_late_minutes',
    group: 'safety',
    label: '시세 지연 기준',
    help: '시세가 이만큼 안 들어오면 신호를 멈춥니다',
    type: 'number',
    defaultValue: 2,
    unit: '분',
    min: 1,
    max: 60,
    usedFrom: '1-C',
    source: '명세 §10.1 SG-01',
  },
  {
    key: 'gate_price_limit_near_ticks',
    group: 'safety',
    label: '상하한가 근접 기준',
    help: '상한가나 하한가까지 이만큼 남으면 신호를 멈춥니다',
    type: 'number',
    defaultValue: 20,
    unit: '틱',
    min: 1,
    max: 500,
    usedFrom: '1-C',
    source: '명세 §10.1 SG-11',
  },
  {
    key: 'gate_margin_tight_rate_percent',
    group: 'safety',
    label: '증거금 여유 기준',
    help: '증거금 유지율이 이 밑으로 내려가면 신호를 멈춥니다',
    type: 'number',
    defaultValue: 100,
    unit: '%',
    min: 50,
    max: 300,
    usedFrom: '1-C',
    source: '명세 §10.1 SG-09',
  },
  {
    key: 'gate_max_broker_failure_streak',
    group: 'safety',
    label: '증권사 연속 실패 기준',
    help: '증권사 조회가 이만큼 연달아 실패하면 신호를 멈춥니다',
    type: 'number',
    defaultValue: 3,
    unit: '회',
    min: 1,
    max: 20,
    usedFrom: '1-C',
    source: '명세 §10.1 SG-02',
  },
  {
    key: 'gate_max_minutes_since_run',
    group: 'safety',
    label: '수집 중단 기준',
    help: '시세 수집이 이만큼 멈추면 신호를 멈춥니다',
    type: 'number',
    defaultValue: 5,
    unit: '분',
    min: 1,
    max: 120,
    usedFrom: '1-C',
    source: '명세 §10.1 SG-03',
  },
  {
    key: 'gate_max_notify_failure_streak',
    group: 'safety',
    label: '알림 연속 실패 기준',
    help: '알림이 이만큼 연달아 실패하면 신호를 멈춥니다',
    type: 'number',
    defaultValue: 3,
    unit: '회',
    min: 1,
    max: 20,
    usedFrom: '1-C',
    source: '명세 §10.1 SG-06',
  },
  {
    key: 'gate_max_unopened_signals',
    group: 'safety',
    label: '안 읽은 신호 기준',
    help: '신호를 이만큼 연달아 안 열어 보면 신호를 멈춥니다',
    type: 'number',
    defaultValue: 3,
    unit: '건',
    min: 1,
    max: 20,
    usedFrom: '1-C',
    source: '명세 §10.1 SG-07',
  },

  // ── 청산 (§8) ───────────────────────────────────────────
  {
    key: 'signal_valid_minutes',
    group: 'exit',
    label: '신호 유효 시간',
    help: '이 안에 체결되면 신호를 따른 것으로 셉니다',
    type: 'number',
    defaultValue: 10,
    unit: '분',
    min: 1,
    max: 120,
    usedFrom: '1-C',
    source: '명세 §8 「신호 유효 시간」',
  },
  {
    key: 'protection_recheck_minutes',
    group: 'exit',
    label: '손절 재확인 간격',
    help: '손절을 걸었는지 이만큼마다 다시 여쭤봅니다',
    type: 'number',
    defaultValue: 60,
    unit: '분',
    min: 5,
    max: 480,
    usedFrom: '1-C',
    source: '명세 §11 D-15',
  },

  // ── 알림 (§12) ──────────────────────────────────────────
  {
    key: 'notify_enabled',
    group: 'notify',
    label: '알림 켜기',
    help: '검증을 통과해야 켤 수 있습니다',
    type: 'boolean',
    defaultValue: false,
    usedFrom: '1-C',
    source: '명세 C4 · §3.2',
  },
  {
    key: 'notify_shadow_days_required',
    group: 'notify',
    label: '알림 켜기 전 연습 일수',
    help: '알림 없이 이만큼 돌려 본 뒤에 켤 수 있습니다',
    type: 'number',
    defaultValue: 5,
    unit: '일',
    min: 1,
    max: 60,
    usedFrom: '1-C',
    source: '명세 §3.2 1-C',
  },
  // ── 지식과 설명 (Release 2 · §16) ───────────────────────
  /**
   * 지식·설명이 쓰는 공급자와 모델 — **이름에 벤더를 안 박는다**
   *
   * 전에는 「Gemini 모델」이었다. 등록된 키가 넷인데 이름부터 한 벌에 묶여 있으면
   * 나머지 키는 있으나 마나다 (사용자 지적 2026-09-27).
   */
  {
    key: 'knowledge_provider',
    group: 'knowledge',
    label: '설명 글 공급자',
    help: '설명과 리포트를 만들 때 부를 회사를 정합니다',
    type: 'choice',
    choices: JUDGE_PROVIDERS,
    defaultValue: 'gemini',
    usedFrom: '1-C',
    source: '명세 §16 · §17.1 기존 AI 계층',
  },
  {
    key: 'knowledge_model',
    group: 'knowledge',
    label: '설명 글 모델',
    help: '설명과 리포트를 만들 때 부를 모델입니다',
    type: 'string',
    defaultValue: '',
    usedFrom: '1-C',
    source: '명세 §16 · §17.1 기존 AI 계층',
  },
  {
    key: 'pattern_window_days',
    group: 'knowledge',
    label: '패턴 리포트 구간',
    help: '며칠치를 보고 패턴을 셀지 정합니다',
    type: 'number',
    defaultValue: 20,
    unit: '일',
    min: 5,
    max: 250,
    usedFrom: '1-C',
    source: '명세 §16 패턴 리포트',
  },
  {
    key: 'pattern_min_samples',
    group: 'knowledge',
    label: '패턴 최소 표본',
    help: '이만큼 안 모이면 리포트를 만들지 않습니다',
    type: 'number',
    defaultValue: 30,
    unit: '건',
    min: 5,
    max: 1000,
    usedFrom: '1-C',
    source: '명세 §16 패턴 리포트',
  },
  {
    key: 'pattern_min_bucket',
    group: 'knowledge',
    label: '패턴 묶음 최소 표본',
    help: '시간대·조건별 칸이 이만큼은 돼야 표에 올린다. 두 건짜리 칸의 승률은 패턴이 아니다',
    type: 'number',
    defaultValue: 5,
    unit: '건',
    min: 2,
    max: 200,
    usedFrom: '1-C',
    source: '명세 §16 패턴 리포트',
  },
  // ── AI 운영자 (Release 3 · §15.3) ───────────────────────
  //
  // **자동이 기본인 항목이 하나도 없다.** 기본값은 아무도 안 고른 값이고,
  // 아무도 안 고른 값으로 AI 가 돈이 걸린 일을 하면 그것은 「하기로 정한 것」이 아니라
  // 「막지 않은 것」이다. 키 접두사가 `ai_intervention_` 이라 스펙 후보 금지 목록이 통째로 막는다.
  {
    key: 'ai_intervention_retry_notifications',
    group: 'operator',
    label: '안 나간 알림 다시 보내기',
    help: '이 조치를 자동으로 할지 승인받고 할지 정합니다',
    type: 'choice',
    choices: ['auto', 'approve', 'off'],
    defaultValue: 'approve',
    usedFrom: '1-C',
    source: '명세 §15.3 AI 개입',
  },
  {
    key: 'ai_intervention_backfill_bars',
    group: 'operator',
    label: '빠진 시세 다시 받기',
    help: '이 조치를 자동으로 할지 승인받고 할지 정합니다',
    type: 'choice',
    choices: ['auto', 'approve', 'off'],
    defaultValue: 'approve',
    usedFrom: '1-C',
    source: '명세 §15.3 AI 개입',
  },
  {
    key: 'ai_intervention_reanalyze_source',
    group: 'operator',
    label: '자료 다시 분석하기',
    help: '이 조치를 자동으로 할지 승인받고 할지 정합니다',
    type: 'choice',
    choices: ['auto', 'approve', 'off'],
    defaultValue: 'approve',
    usedFrom: '1-C',
    source: '명세 §15.3 AI 개입',
  },
  {
    key: 'operator_enabled',
    group: 'operator',
    label: 'AI 운영자 켜기',
    help: '점검과 브리핑을 자동으로 돌립니다',
    type: 'boolean',
    defaultValue: false,
    usedFrom: '1-C',
    source: '명세 §16 Release 3',
  },
  // ── 야간장 (Release 3 · §6.1 · §6.3) ────────────────────
  {
    key: 'night_signal_enabled',
    group: 'instrument',
    label: '야간 신호 켜기',
    help: '야간장에서도 신호를 냅니다. 야간 검증을 통과해야 켜집니다',
    type: 'boolean',
    defaultValue: false,
    usedFrom: '1-C',
    source: '명세 §3.1 Release 3 · §6.1',
  },
  {
    key: 'night_shadow_days_required',
    group: 'instrument',
    label: '야간 신호 켜기 전 연습 일수',
    help: '야간장에서 이만큼 돌려 본 뒤에 켤 수 있습니다',
    type: 'number',
    defaultValue: 5,
    unit: '일',
    min: 1,
    max: 60,
    usedFrom: '1-C',
    source: '명세 §3.2 1-C 섀도 규율을 야간에 적용',
  },
  {
    key: 'operator_max_missing_bars',
    group: 'operator',
    label: '점검: 시세 결측 기준',
    help: '하루에 이만큼 넘게 빠지면 문제로 봅니다',
    type: 'number',
    defaultValue: 5,
    unit: '개',
    min: 0,
    max: 400,
    usedFrom: '1-C',
    source: '명세 §16 Release 3 점검',
  },
  {
    key: 'operator_ai_budget_warn_ratio',
    group: 'operator',
    label: '점검: AI 예산 경고 기준',
    help: '예산을 이만큼 쓰면 알려 줍니다',
    type: 'number',
    defaultValue: 0.8,
    min: 0.1,
    max: 1,
    usedFrom: '1-C',
    source: '명세 §16 Release 3 점검',
  },
  // ── 자동 주문 (Release 4 · docs/trading/RELEASE4_DESIGN.md) ──
  //
  // 무장은 설정이 아니라 **상태**다(`trading_arming`). 여기 있는 것은 문턱뿐이다 —
  // 설정 하나로 켜고 끄면 화면에서 스무 개 값 중 하나로 보이는데 그 하나가 돈을 움직인다.
  {
    key: 'order_max_per_day',
    group: 'autoorder',
    label: '하루 최대 주문 수',
    help: '이만큼 채우면 그날 자동 주문이 꺼집니다',
    type: 'number',
    defaultValue: 12,
    unit: '건',
    min: 1,
    max: 100,
    usedFrom: '1-C',
    source: '설계 §6 멈추는 장치',
  },
  {
    key: 'order_max_failure_streak',
    group: 'autoorder',
    label: '주문 연속 실패 상한',
    help: '이만큼 연달아 실패하면 자동 주문이 꺼집니다',
    type: 'number',
    defaultValue: 3,
    unit: '회',
    min: 1,
    max: 20,
    usedFrom: '1-C',
    source: '설계 §6 멈추는 장치',
  },
  {
    key: 'order_required_paper_days',
    group: 'autoorder',
    label: '자동 주문 전 모의 일수',
    help: '모의 계좌로 이만큼 돌려 본 뒤에 켤 수 있습니다',
    type: 'number',
    defaultValue: 20,
    unit: '일',
    min: 1,
    max: 120,
    usedFrom: '1-C',
    source: '설계 §2 A3 · 명세 §3.2 1-C',
  },
  {
    key: 'order_arm_hours',
    group: 'autoorder',
    label: '자동 주문 지속 시간',
    help: '켜고 이 시간이 지나면 스스로 꺼집니다',
    type: 'number',
    defaultValue: 24,
    unit: '시간',
    min: 1,
    max: 24,
    usedFrom: '1-C',
    source: '설계 §1',
  },
] as const

const BY_KEY = new Map(TRADING_SETTINGS.map((s) => [s.key, s]))

export function tradingSetting(key: string): TradingSetting | null {
  return BY_KEY.get(key) ?? null
}

/** 저장된 판이 하나도 없을 때의 값 전부. 첫 실행이 이 값으로 선다 */
/**
 * 숫자 설정의 초기값 하나. **같은 숫자를 레지스트리 밖에 또 적지 않으려고 있다.**
 *
 * 실측 2026-10-07: `tick.ts` 가 `num('rollover_days_before_last', 3)` 으로 3 을 또 적고 있었다.
 * 레지스트리를 1 로 내려도 저장된 값이 없는 환경은 여전히 3 으로 돌았을 것이고,
 * **설정 화면은 1 이라고 말했을 것이다** — 이 파일 머리글이 막으려는 바로 그 사고다.
 *
 * 숫자 설정이 아닌 키를 물으면 던진다. 조용히 0 을 돌려주면 그 0 이 한도나 기한이 된다
 */
export function numberDefault(key: string): number {
  const found = tradingSetting(key)
  if (!found || typeof found.defaultValue !== 'number') {
    throw new Error(`숫자 설정이 아닙니다: ${key}`)
  }
  return found.defaultValue
}

export function defaultSettings(): Record<string, TradingSettingValue> {
  return Object.fromEntries(TRADING_SETTINGS.map((s) => [s.key, s.defaultValue]))
}

/** 왜 못 저장하는지. 조용히 버리지 않는다 */
export interface SettingRejection {
  reason: string
  userMessage: string
}

/**
 * 이 값을 저장해도 되나.
 *
 * 저장 직전에 부른다. 모르는 키·틀린 형·범위 밖을 여기서 막는다 —
 * DB 에 들어간 뒤에 알면 그 값으로 이미 판단이 한 번 돌아간 뒤다.
 */
export function validateSetting(key: string, value: unknown): SettingRejection | null {
  const spec = tradingSetting(key)
  if (!spec) {
    return {
      reason: `unknown_key:${key}`,
      userMessage: `모르는 설정입니다: ${key}`,
    }
  }

  if (spec.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return { reason: `type_mismatch:${key}`, userMessage: `${spec.label}은 참/거짓 값입니다` }
    }
    return null
  }

  if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { reason: `type_mismatch:${key}`, userMessage: `${spec.label}은 숫자여야 합니다` }
    }
    if (spec.min !== undefined && value < spec.min) {
      return {
        reason: `below_min:${key}`,
        userMessage: `${spec.label}은 ${spec.min}${spec.unit ?? ''} 이상이어야 합니다`,
      }
    }
    if (spec.max !== undefined && value > spec.max) {
      return {
        reason: `above_max:${key}`,
        userMessage: `${spec.label}은 ${spec.max}${spec.unit ?? ''} 이하여야 합니다`,
      }
    }
    return null
  }

  if (typeof value !== 'string') {
    return { reason: `type_mismatch:${key}`, userMessage: `${spec.label}은 글자 값이어야 합니다` }
  }
  if (spec.type === 'choice' && !(spec.choices ?? []).includes(value)) {
    return {
      reason: `not_a_choice:${key}`,
      userMessage: `${spec.label}은 ${(spec.choices ?? []).join(' · ') } 중 하나여야 합니다`,
    }
  }
  return null
}

/**
 * 결측 판정은 확정 여유보다 늦어야 한다.
 *
 * 값 하나씩만 보면 둘 다 맞는데 **둘을 같이 보면 틀린** 조합이 있다.
 * 여유 25 · 결측 10 이면 확정될 기회가 오기 전에 결측으로 적힌다 —
 * 그러면 그 월물은 하루 종일 전부 결측이 되고, 화면은 「KIS 가 안 준다」고 말한다.
 */
export function validateSettingSet(
  values: Readonly<Record<string, TradingSettingValue>>,
): SettingRejection | null {
  const fast = Number(values.sma_fast_period)
  const slow = Number(values.sma_slow_period)
  if (Number.isFinite(fast) && Number.isFinite(slow) && fast >= slow) {
    return {
      reason: 'fast_not_faster',
      userMessage: '단기 이동평균은 장기보다 짧아야 합니다. 같거나 길면 교차가 일어나지 않습니다',
    }
  }

  const grace = Number(values.bar_grace_seconds)
  const missing = Number(values.bar_missing_after_seconds)
  if (Number.isFinite(grace) && Number.isFinite(missing) && missing <= grace) {
    return {
      reason: 'missing_before_grace',
      userMessage: '결측 판정은 확정 봉 여유보다 늦어야 합니다. 그렇지 않으면 모든 봉이 결측이 됩니다',
    }
  }
  return null
}
