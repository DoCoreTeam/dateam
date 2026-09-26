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
    help: '이 모듈을 볼 수 있는 단 한 사람. 관리자여도 이 값이 아니면 못 들어간다',
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
    help: '이 판으로 맞춘 보정 모델이 있어야 신호가 나간다. 비워 두면 판을 안 가리고 아무 보정이나 있으면 된다',
    type: 'string',
    defaultValue: '',
    usedFrom: '1-C',
    source: '명세 §10.1 SG-08 · M3',
  },
  {
    key: 'ev_model_version',
    group: 'basic',
    label: '기대값 모델 판',
    help: '이 판으로 만든 기대값 평균표를 쓴다. 비워 두면 가장 최근 판을 쓴다. 보정이 돼도 이 표가 없으면 SR-01 을 잴 수 없어 신호가 안 나간다',
    type: 'string',
    defaultValue: '',
    usedFrom: '1-C',
    source: '명세 §7.5',
  },
  {
    key: 'ev_min_bucket_samples',
    group: 'basic',
    label: '기대값 구간 최소 표본',
    help: '보정 확률이 속한 구간에 표본이 이만큼은 있어야 그 평균을 기대값으로 쓴다. 적은 표본의 평균은 값이 아니라 잡음이다',
    type: 'number',
    defaultValue: 1,
    unit: '건',
    min: 1,
    max: 1000,
    usedFrom: '1-C',
    source: '명세 §7.5 · §13.4',
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
    key: 'collect_night_session',
    group: 'instrument',
    label: '야간장 수집',
    help: '야간장 봉도 모읍니다. 신호와 판단은 정규장만 — 모으는 것과 판단하는 것은 다른 일입니다',
    type: 'boolean',
    defaultValue: true,
    usedFrom: '1-A',
    source: '명세 §6.1 「야간장도 수집한다(신호는 정규장만)」',
  },
  {
    key: 'night_trade_date_rule',
    group: 'instrument',
    label: '야간장 거래일 귀속',
    help: '저녁에 시작한 장을 다음 거래일로 볼지 그날로 볼지. 손익과 일일 한도가 거래일 기준이라 이 값이 결과를 가릅니다',
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
    key: 'jev_model',
    group: 'decision',
    label: 'Jev 모델',
    help: '관문(Vercel AI Gateway) 뒤에서 부를 모델 이름. 비우면 Jev 판단을 안 부르고 rule 만 기록한다',
    type: 'string',
    // 기본값을 안 정한다. 관문 뒤 모델 이름은 벤더가 수시로 바꾸고, 박아 두면 사라진 날 조용히 404 가 난다
    defaultValue: '',
    usedFrom: '1-A',
    source: '명세 §4 · §17.1 (Jev 호출)',
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
    key: 'bar_retry_count',
    group: 'collect',
    label: '확정 봉 재조회 횟수',
    help: '봉이 아직 안 왔을 때 같은 실행 안에서 이만큼 더 물어본다. 0 이면 다음 분까지 기다린다 — 1분 봉으로 판단하는데 1분을 기다리면 한 판을 통째로 놓친다',
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
    label: '확정 봉 재조회 간격',
    help: '다시 묻기 전에 이만큼 쉰다. 쉬지 않고 두 번 물으면 답이 같다',
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
    /**
     * 실제 1회 위험은 신호마다 ATR 과 손절가로 **계산한다**(§9.1).
     * 이 값은 신호가 아직 없을 때 무장 관문(A6)이 보는 **가정값**이다 —
     * 0 이면 「모른다」라서 관문이 막는다. 실측 2026-09-26: 이 키를 읽는 코드는
     * 있는데 등록부에 없어서 화면에서 고칠 수 없었다
     */
    key: 'risk_per_trade_krw',
    group: 'risk',
    label: '1회 위험 가정값',
    help: '무장 관문이 「한 번에 이만큼 걸 수 있나」를 볼 때 쓰는 값. 실제 신호의 1회 위험은 매번 ATR 과 손절가로 계산하고 이 값을 쓰지 않는다',
    type: 'number',
    defaultValue: 0,
    unit: '원',
    min: 0,
    usedFrom: '1-C',
    source: '명세 §9.1 · 설계 §2 A6',
  },
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
    label: '한 겹 검증 길이',
    help: '접기 하나가 평가하는 거래일 수',
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
    label: '호가 없을 때 슬리피지',
    help: '최우선 호가를 못 받은 봉에 쓸 가정 틱 수. 이 비율이 높으면 그 성적은 실측이 아닙니다',
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
    help: 'ATR 의 몇 배를 손절로 둘 것인가',
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
    help: '검증 구간 합계가 이만큼은 돼야 기대값을 믿을 수 있습니다. 적으면 미달이 아니라 아직 못 잰 것입니다',
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
  {
    key: 'kis_account_product_code',
    group: 'broker',
    label: '계좌상품코드',
    help: '계좌번호 뒤 두 자리. 선물옵션은 보통 03 이다. 계좌번호 자체는 여기 없고 암호화해 따로 둔다',
    type: 'string',
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
    label: 'SR-01 최소 순기대값',
    help: '비용을 뺀 뒤에도 이만큼은 남아야 신호를 낸다. 1회 위험 대비 배수다',
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
    label: 'SR-02 최소 진입 확률',
    help: '보정된 진입 확률이 이 값보다 낮으면 신호를 내지 않는다',
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
    label: 'SR-04 개장 후 금지 분',
    help: '개장 직후에는 값이 튄다. 이만큼 지난 뒤부터 신호를 낸다',
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
    label: 'SR-04 마감 전 금지 분',
    help: '마감이 가까우면 보유 시간이 안 나온다. 이만큼 남으면 새 신호를 안 낸다',
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
    label: 'SR-05 이벤트 전 금지 분',
    help: '등록한 이벤트 앞뒤로는 새 신호를 안 낸다',
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
    label: 'SR-05 이벤트 후 금지 분',
    help: '이벤트가 지난 뒤 이만큼은 값이 정리되기를 기다린다',
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
    label: 'SR-08 쿨다운 연패 수',
    help: '이만큼 연달아 지면 잠시 쉰다',
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
    label: 'SR-08 쿨다운 분',
    help: '연패 뒤 이만큼은 새 신호를 안 낸다',
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
    label: 'SR-09 거래일 최대 신호 수',
    help: '하루에 이만큼까지만 낸다. 많이 낼수록 사람이 골라 따르게 되고 그러면 기록이 전략을 안 나타낸다',
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
    label: 'SR-10 같은 방향 재신호 간격',
    help: '같은 쪽으로 다시 내기까지 이만큼 기다린다',
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
    label: 'SR-12 목표 거리 대비 비용 배수',
    help: '목표까지의 가격 거리가 왕복 비용의 이 배수는 돼야 한다. 비용을 뺀 거리가 아니다',
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
    label: 'SG-01 스프레드 이상 판정 배수',
    help: '최우선 호가 폭이 최근 중앙값의 이 배수를 넘으면 새 신호를 막는다. 평소 폭을 모르면 「이상」을 말할 수 없으므로 기준선이 없는 분은 막지 않고 못 쟀다고 남긴다',
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
    label: 'SG-01 봉 결측·지연 판정 분',
    help: '마지막으로 확정된 판단 봉이 이만큼 전이면 봉이 빠졌거나 늦은 것으로 보고 새 신호를 막는다. bar_grace_seconds 는 한 봉을 기다리는 초이고 이 값은 몇 봉째 안 오는지를 본다',
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
    label: 'SG-11 가격제한 근접 판정 틱',
    help: '현재가가 상한가나 하한가까지 이 틱 수 이내로 붙으면 새 신호를 막는다. 제한폭에 닿으면 반대편 호가가 사라져 손절이 안 나간다',
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
    label: 'SG-09 증거금 빡빡 판정 유지율',
    help: '위탁증거금 유지율이 이 밑으로 내려가면 새 신호를 막는다. 추가 증거금이 붙으면 유지율과 상관없이 막는다',
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
    label: 'SG-02 증권사 연속 실패 수',
    help: '증권사 조회가 이만큼 연달아 실패하면 새 신호를 막는다',
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
    label: 'SG-03 크론 정지 판정 분',
    help: '수집이 이만큼 안 돌면 값이 낡은 것으로 보고 새 신호를 막는다',
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
    label: 'SG-06 알림 연속 실패 수',
    help: '알림이 이만큼 연달아 실패하면 새 신호를 막는다. 안 가는 신호는 없는 신호다',
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
    label: 'SG-07 안 열어 본 연속 신호 수',
    help: '이만큼 연달아 아무도 안 열면 새 신호를 막는다. 안 보는 알림을 계속 보내면 더 안 본다',
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
    help: '이 안에 체결되면 따른 것, 지나서 체결되면 늦게 따른 것으로 적는다',
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
    help: '「손절 설정함」을 누른 지 이만큼 지나면 다시 묻는다. 시스템이 확인할 방법이 없어서다',
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
    help: '검증 관문을 지나기 전에는 켜지지 않는다. 켜고 끈 일은 기록에 남는다',
    type: 'boolean',
    defaultValue: false,
    usedFrom: '1-C',
    source: '명세 C4 · §3.2',
  },
  {
    key: 'notify_shadow_days_required',
    group: 'notify',
    label: '알림 켜기 전 섀도 거래일',
    help: '실시간 섀도를 이만큼 돌려 본 뒤에 알림을 켤 수 있다',
    type: 'number',
    defaultValue: 5,
    unit: '일',
    min: 1,
    max: 60,
    usedFrom: '1-C',
    source: '명세 §3.2 1-C',
  },
  // ── 지식과 설명 (Release 2 · §16) ───────────────────────
  {
    key: 'gemini_model',
    group: 'knowledge',
    label: 'Gemini 모델',
    help: '지식 카드·소스 분석·패턴 리포트·설명을 만들 때 쓰는 모델. 비우면 기본 사슬을 쓴다',
    type: 'string',
    defaultValue: '',
    usedFrom: '1-C',
    source: '명세 §16 · §17.1 기존 AI 계층',
  },
  {
    key: 'pattern_window_days',
    group: 'knowledge',
    label: '패턴 리포트 구간',
    help: '며칠치를 보고 패턴을 세나. 짧으면 표본이 모자라고 길면 옛 장이 섞인다',
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
    help: '이만큼 안 모이면 리포트를 안 만든다. 세 건으로 「패턴을 찾았다」고 말하지 않는다',
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
    label: '개입: 안 나간 알림 다시 보내기',
    help: '자동·승인 뒤·끔. 안전해 보여도 승인으로 시작한다 — 안전한지는 며칠 돌려 보고 사람이 정한다',
    type: 'string',
    defaultValue: 'approve',
    usedFrom: '1-C',
    source: '명세 §15.3 AI 개입',
  },
  {
    key: 'ai_intervention_backfill_bars',
    group: 'operator',
    label: '개입: 빠진 봉 다시 받기',
    help: '자동·승인 뒤·끔',
    type: 'string',
    defaultValue: 'approve',
    usedFrom: '1-C',
    source: '명세 §15.3 AI 개입',
  },
  {
    key: 'ai_intervention_reanalyze_source',
    group: 'operator',
    label: '개입: 자료 다시 분석하기',
    help: '자동·승인 뒤·끔',
    type: 'string',
    defaultValue: 'approve',
    usedFrom: '1-C',
    source: '명세 §15.3 AI 개입',
  },
  {
    key: 'operator_enabled',
    group: 'operator',
    label: 'AI 운영자 켜기',
    help: '점검과 브리핑을 돌린다. 조치는 위 개입 수준을 따로 따른다',
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
    help: '야간장에서도 신호를 낸다. 야간 표본으로 관문을 통과해야 켜진다 — 정규장 통과는 야간에 쓰지 않는다',
    type: 'boolean',
    defaultValue: false,
    usedFrom: '1-C',
    source: '명세 §3.1 Release 3 · §6.1',
  },
  {
    key: 'night_shadow_days_required',
    group: 'instrument',
    label: '야간 신호 켜기 전 섀도 거래일',
    help: '야간 섀도를 이만큼 돌려 본 뒤에 켤 수 있다',
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
    label: '점검: 봉 결측 문턱',
    help: '하루에 이만큼 넘게 빠지면 실패로 본다. 그 아래는 경고',
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
    label: '점검: AI 예산 경고 비율',
    help: '예산을 이만큼 쓰면 경고한다',
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
    help: '이만큼 채우면 그날 무장이 풀린다. 신호 상한 여섯에 진입·청산 둘씩',
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
    help: '이만큼 연달아 실패하면 무장이 풀린다. 나갔는지 모르는 것도 실패로 센다',
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
    label: '무장 전 모의 자동 주문 거래일',
    help: '모의 계좌로 이만큼 돌려 본 뒤에 무장할 수 있다. 실계좌는 여기에 순손익 하한까지 본다',
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
    label: '무장 지속 시간',
    help: '무장은 이 시간이 지나면 스스로 풀린다. 켜 놓고 잊는 일을 구조가 막는다',
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
