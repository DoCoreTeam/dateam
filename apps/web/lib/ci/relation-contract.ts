// lib/ci/relation-contract.ts — 삭제 릴레이션 계약 SSOT
//
// **"부모를 지우면 자식은 어떻게 되는가"를 정하는 단 하나의 자리다.**
//
// 왜 이 파일이 생겼나: 예전에는 그 답이 세 곳으로 흩어져 있었고 셋이 서로 달랐다.
//   ① DB의 FK 규칙(CASCADE/SET NULL) — 표를 만들 때 정해지고 이후 아무도 다시 안 봤다
//   ② delete.ts의 수동 정리 — 게시물·아이디어·기획 3종만 다뤄 채널과 손자가 빠졌다
//   ③ 아무도 안 보는 곳 — ci_jobs.target_id 처럼 FK도 코드도 없는 자리
//   그 결과 채널을 지우자 게시물 55건이 "채널 미확인"으로 남았고(2026-08-18 실측),
//   손으로 치운 작업 20건이 하루 만에 다시 20건 생겼다.
//
// 사용자 결정(2026-08-18, 원문): "채널이 삭제되면 수집함의 컨텐츠 당연히 삭제 되야 하고
//   이런식의 구현에 CRUD와 릴레이션은 FK나 PK를 통해서 정확하게 관리 되어야 해"
//
// 그래서 규칙을 **데이터로** 선언한다. 이 선언 하나가 세 곳을 동시에 지배한다:
//   · 마이그레이션 208 이 이 표대로 FK와 트리거를 건다
//   · previewDelete 가 이 표를 읽어 확인창 문구를 만든다 (화면이 계약과 어긋날 수 없다)
//   · relation-contract.test.ts 가 이 표와 실제 SQL을 대조한다 (선언만 하고 안 거는 것을 막는다)

/** 관계의 종류. 새 참조를 만들 때 반드시 셋 중 하나로 분류한다 — 미분류를 남기지 않는다. */
export type CiRelationKind =
  /** 자식은 부모 없이 존재 이유가 없다. 부모가 사라지면 함께 사라진다(FK ON DELETE CASCADE) */
  | 'owns'
  /** 자식은 독립적으로 존재하고 부모를 가리킬 뿐. 연결만 끊는다(FK ON DELETE SET NULL) */
  | 'refs'
  /** 대기열·예약·기록. FK를 걸 수 없는 폴리모픽이라 DB 트리거가 정리한다 */
  | 'work'

export interface CiRelation {
  kind: CiRelationKind
  /** 자식 테이블 */
  table: string
  /** 자식이 부모를 가리키는 컬럼 */
  column: string
  /**
   * 폴리모픽일 때만: 종류를 담는 컬럼과 이 부모를 뜻하는 값.
   * 이게 있으면 FK를 걸 수 없다는 뜻이고, DB 트리거가 대신 지운다.
   */
  discriminator?: { column: string; value: string }
  /** 확인창에 그대로 나가는 말. 사용자가 읽는 문장이므로 테이블 이름을 쓰지 않는다 */
  label: string
  /** 화면에 셀 필요가 없는 것(내부 대기열 등)은 false — 사용자에게 보고할 대상이 아니다 */
  countForUser: boolean
}

/** 삭제할 수 있는 대상. `CiDeletableKind`(delete.ts)와 같은 집합이어야 한다. */
export type CiRelationParent =
  | 'content' | 'channel' | 'board' | 'idea' | 'brief' | 'editPlan' | 'publication'

/** 부모 테이블 이름 — 가드가 실제 SQL과 대조할 때 쓴다. */
export const CI_PARENT_TABLE: Record<CiRelationParent, string> = {
  content: 'ci_contents',
  channel: 'ci_channels',
  board: 'ci_boards',
  idea: 'ci_ideas',
  brief: 'ci_briefs',
  editPlan: 'ci_edit_plans',
  publication: 'ci_publications',
}

/**
 * 계약 본문.
 *
 * 여기 없는 참조는 **존재하지 않아야 한다.** 새 표가 부모를 가리키면 반드시 여기 추가한다 —
 * 가드가 "선언되지 않은 참조"를 잡아낸다.
 */
export const CI_RELATIONS: Record<CiRelationParent, CiRelation[]> = {
  // ── 채널 ────────────────────────────────────────────────
  // 이 저장소에서 게시물의 대부분은 채널 훑기로 들어온다. 사용자가 등록한 것은 채널이고
  // 게시물은 그 결과물이다 — 채널이 부모다. 남겨 봐야 비교군이 없어 배수가 안 나온다.
  channel: [
    { kind: 'owns', table: 'ci_contents', column: 'channel_id', label: '이 채널에서 수집한 게시물', countForUser: true },
    { kind: 'owns', table: 'ci_publications', column: 'channel_id', label: '이 채널에 올린 게시 기록', countForUser: true },
    { kind: 'work', table: 'ci_jobs', column: 'target_id', discriminator: { column: 'target_type', value: 'channel' }, label: '처리 대기 중인 작업', countForUser: false },
    { kind: 'work', table: 'ci_board_items', column: 'item_id', discriminator: { column: 'item_type', value: 'channel' }, label: '보드에 담긴 항목', countForUser: true },
    { kind: 'work', table: 'ci_corrections', column: 'target_id', discriminator: { column: 'target_type', value: 'channel' }, label: '이 채널에 대한 정정 기록', countForUser: false },
  ],

  // ── 게시물 ──────────────────────────────────────────────
  content: [
    { kind: 'owns', table: 'ci_content_metrics', column: 'content_id', label: '수집한 지표 기록', countForUser: true },
    { kind: 'owns', table: 'ci_content_derived', column: 'content_id', label: '분석 결과(배수·백분위)', countForUser: false },
    { kind: 'owns', table: 'ci_content_creative', column: 'content_id', label: '크리에이티브 분석', countForUser: false },
    { kind: 'owns', table: 'ci_content_media', column: 'content_id', label: '영상 실체 분석', countForUser: false },
    { kind: 'owns', table: 'ci_pattern_evidence', column: 'content_id', label: '성공 공식의 근거', countForUser: false },
    // 발견(ci_discoveries)의 근거. 공식의 근거와 같은 성격이라 같은 계약을 쓴다 —
    // 콘텐츠가 사라지면 그 콘텐츠를 가리키던 근거도 함께 사라진다(마이그 222 CASCADE).
    { kind: 'owns', table: 'ci_discovery_evidence', column: 'content_id', label: '발견의 근거', countForUser: false },
    { kind: 'owns', table: 'ci_snapshot_schedules', column: 'content_id', label: '예약된 지표 촬영', countForUser: false },
    { kind: 'owns', table: 'ci_notifications', column: 'content_id', label: '이 게시물에 대한 알림', countForUser: false },
    // 그룹의 대표가 사라지면 NULL이 된다. 옳은 동작은 형제로 승계지만, CASCADE로 바꾸면
    // 그룹 전체가 사라져 더 틀린다 → 승계 로직이 생길 때 함께 다룬다(마이그 208 주석 참조).
    { kind: 'refs', table: 'ci_content_groups', column: 'representative_content_id', label: '대표로 지정된 묶음', countForUser: false },
    { kind: 'refs', table: 'ci_publications', column: 'tracked_content_id', label: '성과를 추적 중인 게시', countForUser: false },
    { kind: 'work', table: 'ci_jobs', column: 'target_id', discriminator: { column: 'target_type', value: 'content' }, label: '처리 대기 중인 작업', countForUser: false },
    { kind: 'work', table: 'ci_board_items', column: 'item_id', discriminator: { column: 'item_type', value: 'content' }, label: '보드에 담긴 항목', countForUser: true },
    { kind: 'work', table: 'ci_corrections', column: 'target_id', discriminator: { column: 'target_type', value: 'content' }, label: '이 게시물에 대한 정정 기록', countForUser: false },
  ],

  // ── 아이디어 ────────────────────────────────────────────
  idea: [
    { kind: 'owns', table: 'ci_briefs', column: 'idea_id', label: '이 아이디어로 만든 기획(과 그 편집안)', countForUser: true },
    { kind: 'owns', table: 'ci_idea_evidence', column: 'idea_id', label: '아이디어의 근거', countForUser: false },
    { kind: 'work', table: 'ci_board_items', column: 'item_id', discriminator: { column: 'item_type', value: 'idea' }, label: '보드에 담긴 항목', countForUser: true },
  ],

  // ── 기획 ────────────────────────────────────────────────
  brief: [
    { kind: 'owns', table: 'ci_edit_plans', column: 'brief_id', label: '편집안', countForUser: true },
    // 이미 나간 게시 실적과 재사용 가능한 자산은 기획을 지워도 남아야 한다.
    { kind: 'refs', table: 'ci_publications', column: 'brief_id', label: '게시 기록(남고 기획 연결만 끊깁니다)', countForUser: true },
    { kind: 'refs', table: 'ci_assets', column: 'brief_id', label: '자산(남고 기획 연결만 끊깁니다)', countForUser: true },
    { kind: 'refs', table: 'ci_briefs', column: 'parent_brief_id', label: '이 기획에서 파생된 기획', countForUser: false },
    { kind: 'work', table: 'ci_board_items', column: 'item_id', discriminator: { column: 'item_type', value: 'brief' }, label: '보드에 담긴 항목', countForUser: true },
  ],

  // ── 보드 ────────────────────────────────────────────────
  board: [
    { kind: 'owns', table: 'ci_board_items', column: 'board_id', label: '보드에 담긴 항목', countForUser: true },
  ],

  // ── 잎(자식이 없는 것) ──────────────────────────────────
  // 비어 있는 것도 선언이다. "아직 안 적었다"와 "가리키는 것이 없다"를 구분하기 위해 키를 남긴다.
  editPlan: [],
  publication: [],
}

/** 부모가 사라지면 함께 사라지는 것들 — 확인창의 '함께 지워집니다' 목록. */
export function ownedBy(parent: CiRelationParent): CiRelation[] {
  return CI_RELATIONS[parent].filter((r) => r.kind === 'owns' || r.kind === 'work')
}

/** 연결만 끊기는 것들 — 확인창의 '연결만 끊깁니다' 목록. */
export function referencedBy(parent: CiRelationParent): CiRelation[] {
  return CI_RELATIONS[parent].filter((r) => r.kind === 'refs')
}

/** FK를 걸 수 없어 트리거가 지워야 하는 것들. 마이그레이션 가드가 이 목록을 검사한다. */
export function polymorphicRefs(parent: CiRelationParent): CiRelation[] {
  return CI_RELATIONS[parent].filter((r) => r.discriminator != null)
}

/**
 * 고아 계측 쿼리. 이 계약이 지켜지고 있으면 **모든 항목이 0**이다.
 *
 * 정적 검사로는 절대 못 잡는다 — 이미 새고 있는지는 실제 데이터를 세어야만 안다.
 * `pnpm ci:orphans` 가 이 쿼리를 돌린다.
 */
export function orphanProbes(): { label: string; sql: string }[] {
  const probes: { label: string; sql: string }[] = []

  for (const [parent, relations] of Object.entries(CI_RELATIONS) as [CiRelationParent, CiRelation[]][]) {
    const parentTable = CI_PARENT_TABLE[parent]
    for (const r of relations) {
      if (r.kind === 'refs') continue   // 연결이 끊긴 것은 정상이다
      const where = r.discriminator
        ? `x.${r.discriminator.column} = '${r.discriminator.value}' and `
        : `x.${r.column} is not null and `
      probes.push({
        label: `${r.table}.${r.column} → ${parentTable}${r.discriminator ? ` (${r.discriminator.value})` : ''}`,
        sql: `select count(*)::int as n from ${r.table} x where ${where}not exists (select 1 from ${parentTable} p where p.id = x.${r.column})`,
      })
    }
  }

  return probes
}
