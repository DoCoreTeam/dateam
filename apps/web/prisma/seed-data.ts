/**
 * 시드 데이터 (dacrm T0-07) — 순수 데이터. DB 를 모른다.
 *
 * id 를 고정값으로 둔다. 자동 생성 cuid 를 쓰면 두 번째 실행에서 같은 것을 또 만들어
 * 파이프라인이 8개가 된다. 시드는 몇 번을 돌려도 결과가 같아야 한다.
 */

export const WORKSPACE_ID = 'ws_dataalliance'

export interface SeedStage {
  id: string
  name: string
  kind: 'OPEN' | 'WON' | 'LOST'
  position: number
}

export interface SeedPipeline {
  id: string
  name: string
  isDefault: boolean
  position: number
  stages: SeedStage[]
}

function stages(prefix: string, rows: [string, SeedStage['kind']][]): SeedStage[] {
  return rows.map(([name, kind], i) => ({
    id: `st_${prefix}_${i + 1}`,
    name,
    kind,
    position: i + 1,
  }))
}

/**
 * 파이프라인 4종 (TASKS T0-07 지정: GPU 인프라, 파트너십, 공공, KDC 제품)
 *
 * 스테이지 이름은 명세에 없어 여기서 정한다. 규칙 두 가지만 지켰다.
 *  - 모든 파이프라인은 WON 1개와 LOST 1개를 반드시 갖는다(보드의 won/lost 드롭 대상, 명세 6.3)
 *  - 진행 스테이지는 "우리가 다음에 무엇을 하는가"로 이름 짓는다(고객 상태가 아니라 우리 행동)
 */
export const SEED_PIPELINES: SeedPipeline[] = [
  {
    id: 'pl_gpu', name: 'GPU 인프라', isDefault: true, position: 1,
    stages: stages('gpu', [
      ['리드', 'OPEN'],
      ['요구사항 파악', 'OPEN'],
      ['견적·제안', 'OPEN'],
      ['기술검증(PoC)', 'OPEN'],
      ['계약 협상', 'OPEN'],
      ['수주', 'WON'],
      ['실주', 'LOST'],
    ]),
  },
  {
    id: 'pl_partner', name: '파트너십', isDefault: false, position: 2,
    stages: stages('partner', [
      ['발굴', 'OPEN'],
      ['초기 접촉', 'OPEN'],
      ['협업 범위 협의', 'OPEN'],
      ['계약 검토', 'OPEN'],
      ['체결', 'WON'],
      ['무산', 'LOST'],
    ]),
  },
  {
    id: 'pl_public', name: '공공', isDefault: false, position: 3,
    stages: stages('public', [
      ['사업 발굴', 'OPEN'],
      ['사전 영업', 'OPEN'],
      ['제안서 작성', 'OPEN'],
      ['입찰', 'OPEN'],
      ['낙찰', 'WON'],
      ['유찰', 'LOST'],
    ]),
  },
  {
    id: 'pl_kdc', name: 'KDC 제품', isDefault: false, position: 4,
    stages: stages('kdc', [
      ['리드', 'OPEN'],
      ['제품 데모', 'OPEN'],
      ['견적', 'OPEN'],
      ['도입 협의', 'OPEN'],
      ['계약', 'WON'],
      ['실주', 'LOST'],
    ]),
  },
]

/** 워크스페이스 소유자 — 호스트 profiles.id 를 그대로 쓴다(CrmMember.hostUserId) */
export const SEED_OWNER = {
  hostUserId: 'f687c53a-2a1e-4616-9fc4-2c4b52b77d7f',
  displayName: '김도현',
  email: 'michaelkim@data-alliance.com',
  role: 'OWNER' as const,
}

export const SEED_WORKSPACE = {
  id: WORKSPACE_ID,
  name: '데이터얼라이언스',
  defaultCurrency: 'KRW',
  defaultLanguage: 'ko',
  timezone: 'Asia/Seoul',
}
