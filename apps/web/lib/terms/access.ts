/**
 * 접근권한의 말 — SSOT (용어집 §2-4)
 *
 * **왜 여기 있나**: 이 도메인의 말은 전부 새 말이다(표면·부여·열기·막기·하위 조직까지).
 * 새 말을 화면에 직접 적으면 두 번째 화면이 그 글자를 복붙하고, 그때부터 두 벌이 된다.
 * 회의노트 `STATUS_META` 가 세 화면에 오탈자까지 복제된 전례가 이미 있다(§0-2).
 * 그래서 화면보다 **먼저** 여기 적는다.
 *
 * ## 왜 「구성원」이 `ENTITY` 에 없나
 *
 * `ENTITY` 는 사용자가 다루는 **업무 개체**의 표다(회사·딜·견적…). 구성원은 그 개체가 아니라
 * **이 시스템을 쓰는 사람** 자신이라 성격이 다르다. 그리고 `ENTITY.person`(인물)은 CRM 의
 * 고객 쪽 사람이라 이름을 빌리면 두 뜻이 한 낱말에 붙는다 — 그게 「담당자·연락처」가
 * 갈렸던 방식이다. 세는 말은 여기서 한 번만 정한다.
 */

/** 접근권한 화면의 이름들. 화면이 제목·레이블에 쓴다 */
export const ACCESS = {
  /**
   * 화면 이름. **사이드바와 제목이 같은 상수를 읽는다**(§2-3-3 N-4) —
   * 같은 경로를 두 곳이 다르게 부르면 사용자는 다른 화면이라고 읽는다.
   */
  screen: '접근권한',
  /** 접근권한을 걸 수 있는 화면 하나. 하위 경로는 전부 그 표면에 속한다 */
  surface: '표면',
  /** 표면 하나를 누구에게 열거나 막은 기록 한 줄 */
  grant: '부여',
  /** 부여를 받는 쪽 — 사람이거나 조직이다 */
  subject: '주체',
  /**
   * 열지 막을지 고르는 칸의 이름. **「열기」를 칸 이름으로 쓰지 않는다** —
   * 고르는 값 하나(열기)가 칸 이름이면 「막기」를 고른 뒤 이름과 값이 어긋난다.
   */
  effect: '여닫기',
  /** 부여가 0건일 때의 답 */
  defaultAudience: '기본값',
  /** 조직 부여가 하위 조직으로 내려가나 */
  includeDescendants: '하위 조직까지',
  /** 코드 등재부를 표에 맞추는 일 */
  sync: '등재',
} as const

/**
 * 막음이 열기를 이긴다(`lib/access/decide.ts` 판정 2단계).
 * 그 순서를 화면도 같은 말로 말해야 관리자가 결과를 예측할 수 있다.
 */
export const ACCESS_EFFECT_LABEL: Record<'allow' | 'deny', string> = {
  allow: '열기',
  deny: '막기',
}

/** 고르는 차례. 기본은 열기다 — 막기는 이미 열린 것을 되돌릴 때만 쓴다 */
export const ACCESS_EFFECT_ORDER: readonly ('allow' | 'deny')[] = ['allow', 'deny']

/** 열린 것은 통과, 막힌 것은 멈춤 — 색이 뜻을 따라오게 `StatusKey` 에 맞춘다 */
export const ACCESS_EFFECT_STATUS: Record<'allow' | 'deny', 'done' | 'blocker'> = {
  allow: 'done',
  deny: 'blocker',
}

export const ACCESS_SUBJECT_LABEL: Record<'user' | 'org', string> = {
  user: '사람',
  org: '조직',
}

export const ACCESS_SUBJECT_ORDER: readonly ('user' | 'org')[] = ['user', 'org']

/** 표면 기본값. 「전부」는 로그인한 사람 전부다 — 로그인 전은 이 판정에 오지 않는다 */
export const ACCESS_AUDIENCE_LABEL: Record<'all' | 'admin', string> = {
  all: '전부',
  admin: '관리자',
}

/** 「전부」는 들어가는 자리, 「관리자」는 제한이라 다른 색을 쓴다 */
export const ACCESS_AUDIENCE_STATUS: Record<'all' | 'admin', 'done' | 'note'> = {
  all: 'done',
  admin: 'note',
}

/** 이 부여가 실제로 걸리는 사람 수. 화면이 조수사를 고르지 않는다 */
export function accessPeopleCount(n: number): string {
  return `구성원 ${n}명`
}

/** 표면 하나에 달린 부여 수 */
export function accessGrantCount(n: number): string {
  return `${ACCESS.grant} ${n}건`
}

/**
 * 표면 등재 상태 한 줄.
 *
 * **왜 화면에 뜨나**: 진실은 코드(`lib/access/surfaces.ts`)에 있고 표는 사본이다.
 * 사본이 코드를 못 따라간 순간이 있었는지 관리자가 알 길이 없으면,
 * 「열어 줬는데 안 열린다」가 왜 생겼는지 아무도 되짚지 못한다.
 */
export function accessSurfaceCount(n: number): string {
  return `${ACCESS.surface} ${n}개`
}

/**
 * 이번에 표에 처음 넣은 표면.
 *
 * **0이어도 그린다.** 「0개」는 사본이 코드를 그대로 따라가고 있다는 사실이고,
 * 줄이 사라지면 그 사실과 「이 화면이 등재를 안 본다」를 구분할 수 없다.
 */
export function accessSyncedLine(n: number): string {
  return `이번에 새로 ${ACCESS.sync}한 ${ACCESS.surface} ${n}개`
}

/** 코드에서 사라졌는데 표에 남은 표면. 사람이 봐야 한다 — 동기화가 지우지 않기 때문이다 */
export function accessOrphanLine(keys: readonly string[]): string {
  return `코드에 없는데 표에 남은 ${ACCESS.surface} ${keys.length}개 (${keys.join(', ')})`
}

export const ACCESS_EMPTY_TITLE = `${ACCESS.grant}가 아직 없어요`

/** 빈 상태는 다음 행동을 한 줄로 말한다(§0-2 문형) */
export const ACCESS_EMPTY_HINT = `아래에서 ${ACCESS.subject}를 고르고 ${ACCESS.defaultAudience}과 다르게 여닫을 수 있어요`

/** 부여가 0건이면 지금 화면과 같다 — 그 사실을 화면이 먼저 말한다 */
export const ACCESS_DEFAULT_NOTE =
  `${ACCESS.grant}가 없는 ${ACCESS.surface}은 ${ACCESS.defaultAudience}대로 보입니다. 관리자는 언제나 통과합니다.`

/** 조직 부여에만 뜻이 있는 칸이라, 사람 부여에서는 왜 안 보이는지 밝힌다 */
export const ACCESS_DESCENDANTS_HINT = '끄면 그 조직에 직접 속한 사람만 걸립니다'
