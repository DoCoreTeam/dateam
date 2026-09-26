/**
 * 접근권한의 말 — SSOT (용어집 §2-4)
 *
 * **왜 여기 있나**: 이 도메인의 말은 전부 새 말이다(표면·부여·자리·하위 조직까지).
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
   * 허용할지 차단할지 고르는 칸의 이름. **값 하나를 칸 이름으로 쓰지 않는다** —
   * 「허용」이 칸 이름이면 「차단」을 고른 뒤 이름과 값이 어긋난다.
   */
  effect: '접근',
  /** 부여가 0건일 때의 답 */
  defaultAudience: '기본값',
  /** 조직 부여가 하위 조직으로 내려가나 */
  includeDescendants: '하위 조직까지',
  /** 코드 등재부를 표에 맞추는 일 */
  sync: '등재',
  /**
   * 표면 안의 더 작은 자리. **「구역」이라고 부르지 않는다** —
   * 코드 이름(`Zone`)은 그대로 두되, 관리자가 읽는 말은 「자리」다.
   * 「구역」은 조직·지역을 먼저 떠올리게 하고 이 표는 조직도 옆에 있다.
   */
  zone: '자리',
  /** 자리를 안 고른 것 — 표면에 걸면 그 아래 자리 전부에 내려간다 */
  wholeSurface: '표면 전체',
  /** 들어간 다음에 어디까지 하나 — 보기·쓰기·내보내기 */
  canDo: '할 수 있는 것',
  /**
   * 표면 하나를 **혼자** 맡는 사람. 부여와 다른 축이다 —
   * 부여는 「누구누구에게 연다」이고 소유자는 「이 한 사람 말고는 아무도 아니다」다.
   */
  owner: '소유자',
} as const

/**
 * 차단이 허용을 이긴다(`lib/access/decide.ts` 판정 2단계).
 * 그 순서를 화면도 같은 말로 말해야 관리자가 결과를 예측할 수 있다.
 *
 * **「막기」라고 부르지 않는다.** 이 시스템은 이미 `차단`·`차단됨` 을 쓴다
 * (`lib/gpu/confidence-gate.ts` 의 `block` · `lib/vercel/normalize.ts` 의 `BLOCKED` ·
 * CRM 예산 카드의 `blocked`, 셋 다 `status: 'blocker'`). 같은 뜻에 새 말을 지으면
 * 사용자는 「차단」과 「막기」를 다른 일로 읽는다 — 그것이 「지우기 vs 삭제」가 갈린 방식이다.
 */
export const ACCESS_EFFECT_LABEL: Record<'allow' | 'deny', string> = {
  allow: '허용',
  deny: '차단',
}

/** 고르는 차례. 기본은 허용이다 — 차단은 이미 허용된 것을 되돌릴 때만 쓴다 */
export const ACCESS_EFFECT_ORDER: readonly ('allow' | 'deny')[] = ['allow', 'deny']

/** 허용은 통과, 차단은 멈춤 — 색이 뜻을 따라오게 `StatusKey` 에 맞춘다(차단은 기존 `blocker` 와 같은 색) */
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
export const ACCESS_EMPTY_HINT = `아래에서 ${ACCESS.subject}를 고르고 ${ACCESS.defaultAudience}과 다르게 ${ACCESS_EFFECT_LABEL.allow}하거나 ${ACCESS_EFFECT_LABEL.deny}할 수 있어요`

/** 부여가 0건이면 지금 화면과 같다 — 그 사실을 화면이 먼저 말한다 */
export const ACCESS_DEFAULT_NOTE =
  `${ACCESS.grant}가 없는 ${ACCESS.surface}은 ${ACCESS.defaultAudience}대로 보입니다. 관리자는 언제나 통과합니다.`

/** 조직 부여에만 뜻이 있는 칸이라, 사람 부여에서는 왜 안 보이는지 밝힌다 */
export const ACCESS_DESCENDANTS_HINT = '끄면 그 조직에 직접 속한 사람만 걸립니다'

/** 파일로 빼는 것이 막혔을 때. 「권한이 없습니다」만 쓰면 무엇이 막혔는지 모른다 */
export const EXPORT_DENIED = '이 자료를 파일로 내보낼 권한이 없습니다. 필요하면 관리자에게 요청해 주세요.'

/** 값을 바꾸는 것이 막혔을 때 */
export const WRITE_DENIED = '이 자료를 바꿀 권한이 없습니다. 보기만 할 수 있습니다.'

/** 동작의 말 — 관리자 화면이 프리셋을 그릴 때 쓴다 */
export const ACCESS_ACTION_LABEL: Record<'view' | 'write' | 'export', string> = {
  view: '보기',
  write: '쓰기',
  export: '내보내기',
}

/**
 * 프리셋의 말. **차단의 묶음**이라 이름도 「어디까지 되는가」로 적는다 —
 * 「쓰기 금지」라고 적으면 무엇이 되는지를 관리자가 뺄셈으로 알아내야 한다.
 */
export const ACCESS_PRESET_LABEL: Record<'viewOnly' | 'write' | 'exportToo', string> = {
  viewOnly: '보기만',
  write: '쓰기까지',
  exportToo: '내보내기까지',
}

export const ACCESS_PRESET_ORDER: readonly ('viewOnly' | 'write' | 'exportToo')[] =
  ['viewOnly', 'write', 'exportToo']

/** 프리셋을 안 쓰고 표면만 여닫을 때 */
export const ACCESS_PRESET_NONE = '제한 없음'

/**
 * 범위의 말 — **누구의 것을 보나.**
 *
 * 조직 스코프가 정한 것을 옮겨 적기만 한다(`lib/access/capabilities.ts`).
 * 화면이 「전사」라고 말하는데 실제로는 부서까지면 관리자가 잘못 연다.
 */
export const ACCESS_RANGE_LABEL: Record<'self' | 'dept' | 'all', string> = {
  self: '내 것',
  dept: '부서',
  all: '전사',
}

/** 범위가 왜 그런지 — 관리자가 조직도를 안 열어 보고도 알 수 있게 */
export const ACCESS_RANGE_WHY: Record<'self' | 'dept' | 'all', string> = {
  self: '관할 부서가 없어 자기 것과 소속 부서만 봅니다',
  dept: '관할 부서가 있어 그 아래까지 봅니다',
  all: '전사 권한이라 모든 부서를 봅니다',
}

/**
 * 소유자의 말 — **부여로는 못 여는 문이 있다는 사실을 화면이 먼저 말한다.**
 *
 * 실측 2026-09-26: `access_grant` 에 AI 트레이딩을 관리자에게 여는 줄이 이미 있었는데도
 * 아무도 못 들어갔다. 소유자가 빈 값이면 소유자 문이 그 위에서 따로 닫히기 때문이다.
 * 관리자는 허용을 눌러 놓고 **아무 일도 안 일어나는 것**만 봤다. 그래서 소유자 칸 옆에
 * 왜 그런지를 붙인다 — 칸만 세우면 다음 사람이 같은 자리에서 같은 것을 겪는다.
 */
export const ACCESS_OWNER_WHY =
  '부여와 별개로 걸리는 문입니다. 여기 적힌 한 사람 말고는 관리자여도 들어가지 못합니다'

/** 아직 아무도 아닐 때. **「없음」이라고만 쓰지 않는다** — 그 상태의 결과를 함께 말한다 */
export const ACCESS_OWNER_NONE = '아직 아무도 아닙니다 (지금은 관리자도 못 들어갑니다)'

/**
 * 적힌 id 가 가리키는 사람이 없을 때.
 *
 * 이름 자리에 id 를 그리지 않는다 — 그러면 「지정돼 있다」로 읽히고, 실제로는 그 문이 닫혀 있다.
 */
export const ACCESS_OWNER_GONE = '지정된 사람을 찾지 못했습니다. 다시 지정해 주세요'

/** 값의 말 — 같은 화면 안에서도 가려지는 칸이 있다 */
export const ACCESS_CAPABILITY_LABEL: Record<string, string> = {
  'cost.view': '원가 보기',
  'cost.edit': '원가 고치기',
  'margin.view': '마진 보기',
  'quote.send': '견적 보내기',
  'quote.approve': '견적 승인',
  'owner.reassign': '담당자 변경',
}

/**
 * 옮겨가는 중이라는 사실만 말한다 — **갈 수 없는 사람에게 가라고 하지 않는다.**
 *
 * 구 영업 화면은 「영업 CRM 으로 옮겨가는 중입니다, 새 건은 그쪽에서 만드세요」라고 안내하는데,
 * 그 CRM 이 닫혀 있는 사람에게는 할 수 없는 일을 시키는 말이 된다.
 * 그렇다고 문장을 통째로 지우면 **옮겨가는 중이라는 사실 자체를 못 듣는다** — 그건 다른 손해다.
 */
export const LEGACY_MOVING_ONLY = '이 화면들은 정리 중입니다. 새 영업 건은 담당자에게 확인해 주세요.'
