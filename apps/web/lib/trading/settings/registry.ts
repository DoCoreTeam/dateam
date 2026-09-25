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

/** 값 하나가 어느 묶음에 속하나. 설정 화면의 절이 이 순서로 선다 */
export type TradingSettingGroup =
  | 'basic'      // 기본
  | 'instrument' // 상품·세션
  | 'decision'   // 판단
  | 'collect'    // 수집
  | 'broker'     // 증권사 연결
  | 'risk'       // 일일 한도
  | 'replay'     // 체결 재현

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
    help: '이 모듈을 볼 수 있는 단 한 사람. 관리자여도 이 값이 아니면 못 들어간다',
    type: 'string',
    // 비어 있으면 아무도 못 들어간다 — 열어 두는 것보다 닫아 두고 시작하는 쪽이 맞다
    defaultValue: '',
    usedFrom: '1-A',
    source: '명세 §14.5 · M11',
  },
  {
    key: 'decision_spec_version',
    group: 'basic',
    label: '판단 스펙 판',
    help: '판단 한 줄마다 함께 적는 스펙 번호. 규칙을 바꾸면 이 값을 올려 옛 판단과 섞이지 않게 한다',
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
    help: '신호를 낼 상품. 정규 선물 데이터도 함께 모으고 최종 선택은 1-B 리스크 산술로 한다',
    type: 'choice',
    choices: ['MINI_KOSPI200', 'KOSPI200'],
    defaultValue: 'MINI_KOSPI200',
    usedFrom: '1-A',
    source: '명세 §19 「상품」',
  },
  {
    key: 'front_contract_code_override',
    group: 'instrument',
    label: '근월물 코드 직접 지정',
    help: 'KIS 종목 정보를 못 받았을 때 쓸 월물 코드. 비워 두면 종목 정보로 정한다',
    type: 'string',
    defaultValue: '',
    usedFrom: '1-A',
    source: '명세 §20 「종목 정보」',
  },
  {
    key: 'rollover_days_before_last',
    group: 'instrument',
    label: '월물 교체 기한',
    help: '늦어도 최종거래일 이 일수 전에는 차월물로 바꾼다. 거래량이 먼저 넘으면 그날 바꾼다',
    type: 'number',
    defaultValue: 3,
    unit: '거래일',
    min: 1,
    max: 10,
    usedFrom: '1-A',
    source: '명세 §6.3',
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
    help: '어느 봉이 확정될 때 판단하나. 1·5·15분 비교는 1-B 검증에서 한다',
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
    help: '사람이 1~3분 늦게 들어가도 뜻이 남으려면 이보다 길게 잡는다',
    type: 'number',
    defaultValue: 15,
    unit: '분',
    min: 1,
    max: 240,
    usedFrom: '1-A',
    source: '명세 §19 「보유 기준」',
  },
  {
    key: 'atr_period',
    group: 'decision',
    label: 'ATR 기간',
    help: '변동성을 재는 봉 수. 손절 거리와 조건 세기가 전부 이 값 위에 선다',
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
    help: '교차 조건의 빠른 쪽. 장기보다 짧아야 한다',
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
    help: '교차 조건의 느린 쪽',
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
    help: '직전 이만큼의 고가·저가를 넘으면 돌파로 본다',
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
    help: 'ATR 의 몇 배를 넘어야 돌파로 치나. 0 이면 한 틱만 넘어도 걸린다',
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
    label: 'Jev 대기 시간',
    help: '이보다 늦게 오면 기권한다. 짧게 잡으면 변동이 큰 순간에만 기권이 몰려 기회를 놓친다',
    type: 'number',
    defaultValue: 10,
    unit: '초',
    min: 1,
    max: 30,
    usedFrom: '1-A',
    source: '명세 §19 「Jev 대기 시간」 · D-41',
  },

  // ── 수집 ────────────────────────────────────────────────
  {
    key: 'bar_grace_seconds',
    group: 'collect',
    label: '확정 봉 여유',
    help: '봉이 끝나고 이 시간이 지나면 다음 분 봉이 안 보여도 확정으로 본다',
    type: 'number',
    defaultValue: 10,
    unit: '초',
    min: 1,
    max: 55,
    usedFrom: '1-A',
    source: '명세 §19 · §6.2 graceSec',
  },
  {
    key: 'bar_missing_after_seconds',
    group: 'collect',
    label: '결측 판정',
    help: '봉이 끝나고 이 시간까지 안 오면 그 분의 판단을 건너뛰고 결측으로 적는다',
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
    label: 'KIS 환경',
    help: '분봉 조회가 모의투자를 지원하지 않아 실전 조회 전용 키를 쓴다. 주문 코드가 없어 위험이 없다',
    type: 'choice',
    choices: ['real', 'paper'],
    defaultValue: 'real',
    usedFrom: '1-A',
    source: '명세 §19 「개발 환경 KIS 키」',
  },
  {
    key: 'kis_min_interval_ms',
    group: 'broker',
    label: 'KIS 호출 최소 간격',
    help: '조회를 이 간격보다 촘촘하게 보내지 않는다. KIS 한도보다 넉넉히 낮게 잡는다',
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
    label: '토큰 재발급 여유',
    help: '만료가 이만큼 남기 전에는 어떤 실행도 재발급을 부르지 않는다. 1분 1회 제한에 걸리면 조회가 통째로 막힌다',
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
    key: 'daily_loss_limit_krw',
    group: 'risk',
    label: '일일 손실 한도',
    help: '하루에 여기까지만 잃는다. 남은 여유가 1회 위험보다 작으면 새 신호를 내지 않는다',
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
    help: '오늘 실현 손익이 여기에 닿으면 새 신호를 끝낸다',
    type: 'number',
    defaultValue: 300000,
    unit: '원',
    min: 0,
    usedFrom: '1-C',
    source: '명세 §19 「일일 목표」',
  },

  // ── 체결 재현 ───────────────────────────────────────────
  {
    key: 'replay_order_type',
    group: 'replay',
    label: '주문 방식',
    help: '체결 재현이 가정하는 주문 방식. 실제 주문은 사람이 하고 시스템은 부르지 않는다',
    type: 'choice',
    choices: ['market', 'limit'],
    defaultValue: 'market',
    usedFrom: '1-B',
    source: '명세 §19 「주문 방식(체결 재현용)」',
  },
  {
    key: 'fee_rate',
    group: 'replay',
    label: '수수료율',
    help: '1-B 를 시작하기 전에 실제 값으로 바꾼다. 0 인 채로 검증하면 기대값이 부풀어 나온다',
    type: 'number',
    defaultValue: 0,
    min: 0,
    usedFrom: '1-B',
    source: '명세 §19 「수수료율」',
  },
] as const

const BY_KEY = new Map(TRADING_SETTINGS.map((s) => [s.key, s]))

export function tradingSetting(key: string): TradingSetting | null {
  return BY_KEY.get(key) ?? null
}

/** 저장된 판이 하나도 없을 때의 값 전부. 첫 실행이 이 값으로 선다 */
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
