/**
 * 시드 데이터 (dacrm T0-07) — 순수 데이터. DB 를 모른다.
 *
 * id 를 고정값으로 둔다. 자동 생성 cuid 를 쓰면 두 번째 실행에서 같은 것을 또 만들어
 * 파이프라인이 8개가 된다. 시드는 몇 번을 돌려도 결과가 같아야 한다.
 */

// 워크스페이스 id 의 SSOT 는 앱 코드(lib/crm/workspace.ts)다.
// 시드는 개발 도구지 런타임이 아니므로, 앱이 시드를 참조하는 방향이면 안 된다.
export { DEFAULT_CRM_WORKSPACE_ID as WORKSPACE_ID } from '../lib/crm/workspace.ts'
import { DEFAULT_CRM_WORKSPACE_ID } from '../lib/crm/workspace.ts'

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
 * 새 워크스페이스가 받는 파이프라인.
 *
 * **왜 4개에서 1개로 줄였나**: TASKS T0-07 이 4종(GPU 인프라·파트너십·공공·KDC 제품)을
 * 지정했고 그대로 넣었다. 그런데 실사용에서 **3개가 딜 0건인 채 화면을 차지했다** —
 * 딜 화면 탭 3칸, 리포트 세로 3블록이 "0건 0건 0건"이었다.
 * 그리고 사용자가 "KDC 제품이라니 전혀 연관없는 내용"이라고 지적했다.
 *
 * 4개를 주고 3개를 지우게 하는 것보다 **1개로 시작해 필요한 만큼 늘리는 편**이 낫다.
 * 이제 [관리 → 영업 단계]에서 직접 만들 수 있으므로 늘리는 데 비용이 거의 없다.
 *
 * ⚠️ 이 목록은 **새 워크스페이스에만** 적용된다. 이미 만들어진 것은 건드리지 않는다.
 *
 * 스테이지 규칙 두 가지:
 *  - 모든 파이프라인은 WON 1개와 LOST 1개를 반드시 갖는다(딜을 닫을 곳이 없으면 영원히 열려 있다)
 *  - 진행 스테이지는 "우리가 다음에 무엇을 하는가"로 이름 짓는다(고객 상태가 아니라 우리 행동)
 */
export const SEED_PIPELINES: SeedPipeline[] = [
  {
    id: 'pl_gpu', name: '영업', isDefault: true, position: 1,
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
]

/** 워크스페이스 소유자 — 호스트 profiles.id 를 그대로 쓴다(CrmMember.hostUserId) */
export const SEED_OWNER = {
  /** 고정 id — 유일성은 DB 의 부분 유니크 인덱스(마이그 201)가 지키므로 upsert 는 id 로 한다 */
  id: 'mb_owner',
  hostUserId: 'f687c53a-2a1e-4616-9fc4-2c4b52b77d7f',
  displayName: '김도현',
  email: 'michaelkim@data-alliance.com',
  role: 'OWNER' as const,
}

export const SEED_WORKSPACE = {
  id: DEFAULT_CRM_WORKSPACE_ID,
  name: '데이터얼라이언스',
  defaultCurrency: 'KRW',
  defaultLanguage: 'ko',
  timezone: 'Asia/Seoul',
}
