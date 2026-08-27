// 시작하기 (셋업 체크리스트)
//
// **왜 필요한가**: 처음 CRM 을 연 사람은 **무엇부터 해야 하는지 모른다.**
// 우리 화면에는 메뉴가 12개 있고, 그중 어느 것이 "먼저"인지 아무도 알려 주지 않았다.
//
// 업계 정설은 순서가 정해져 있다 —
// **① 영업 프로세스를 정한다 → ② 데이터를 옮긴다 → ③ 운영한다.**
// (Salesforce·TechnologyAdvice·Pipedrive 도입 가이드가 모두 같은 순서다.
//  그래서 Pipedrive 는 셋업 마법사를 내장하고 2~3일이면 도입된다.)
//
// **왜 투어(driver.js)가 아니라 체크리스트인가**:
// 투어는 한 번 보고 끝나고 중간에 나가면 다시 못 찾는다.
// 체크리스트는 **상태**라서 언제 돌아와도 어디까지 했는지 보인다.
// 그리고 우리가 판정하므로 **사용자가 "했다"고 누를 필요가 없다** —
// 회사를 만들면 그 항목이 저절로 체크된다.

import type { CrmDb } from '../db/client.ts'
import { ENTITY, count, createLabel } from '../../terms/index.ts'

/**
 * 셋업 단계 — **셋뿐이다.**
 *
 * 예전엔 `next_action`(딜마다 다음 할 일)이 넷째로 있었다. 그런데 그건 셋업이 아니라
 * **운영 지표**다 — 영업을 하는 한 그 숫자는 계속 0과 1 사이를 오간다.
 * 딜을 하나 새로 만드는 순간 `complete` 가 풀려 **「시작하기」가 다시 떴다.**
 * 사용자 지적(2026-08-27): *"이건 계속 나와있는거야? 온보딩?"*
 *
 * 게다가 같은 숫자를 바로 아래 배너(`TodayClient` 의 `unplanned`)가 이미 말하고 있어
 * **한 화면이 같은 사실을 두 번** 말했다.
 *
 * 셋업은 **한 번 하면 끝나는 것**만 담는다. 그래야 다 하면 화면에서 사라진다.
 */
export type SetupStepId = 'pipeline' | 'company' | 'deal'

export interface SetupStep {
  id: SetupStepId
  title: string
  /** 왜 이걸 먼저 하나 — 이유 없는 지시는 사람이 안 따른다 */
  why: string
  done: boolean
  /** 지금 상태 한 줄 — 무엇이 남았는지 숫자로 */
  status: string
  action: { label: string; href: string }
  /** 곁들이는 두 번째 길 (엑셀 올리기 등) */
  alt?: { label: string; href: string }
}

export interface SetupProgress {
  steps: SetupStep[]
  doneCount: number
  /** 다 끝났나 — 끝나면 이 화면은 사라진다 */
  complete: boolean
  /** 지금 해야 할 것 하나 — 목록을 다 읽게 하지 않는다 */
  current: SetupStepId | null
}

/**
 * 시드로 넣어 둔 이름들.
 *
 * 이게 그대로 남아 있으면 **아직 자기 것으로 만들지 않았다는 뜻**이다.
 * (실제로 "KDC 제품"이 사업과 안 맞는데 화면을 차지하고 있었다.)
 */
const SEED_PIPELINE_NAMES = new Set(['GPU 인프라', '파트너십', '공공', 'KDC 제품'])

export async function buildSetupProgress(db: CrmDb): Promise<SetupProgress> {
  // 실패해도 화면이 떠야 한다 — 안내가 못 뜬다고 CRM 을 못 쓰면 그게 더 나쁘다
  const [pipelines, companies, deals] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmPipeline.findMany({ select: { name: true } }).catch(() => []) as Promise<{ name: string }[]>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmCompany.count().catch(() => 0) as Promise<number>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmDeal.count({ where: { status: 'OPEN' } }).catch(() => 0) as Promise<number>,
  ])

  const seedLeft = pipelines.filter((p) => SEED_PIPELINE_NAMES.has(p.name)).length
  const custom = pipelines.length - seedLeft

  const steps: SetupStep[] = [
    {
      id: 'pipeline',
      title: '영업 단계를 우리 회사에 맞게 정리하세요',
      why: '단계가 정해져야 딜을 그 순서대로 관리할 수 있어요. 이걸 먼저 하는 게 순서입니다.',
      // 처음 넣어 둔 것을 하나라도 손봤으면 자기 것으로 만든 것이다
      done: seedLeft === 0 || custom > 0,
      status: seedLeft > 0
        ? `처음 넣어 둔 ${seedLeft}개가 그대로예요${custom > 0 ? ` (직접 만든 것 ${custom}개)` : ''}`
        : `${pipelines.length}개를 쓰고 있어요`,
      action: { label: '영업 단계 정리하기', href: '/crm/process' },
    },
    {
      id: 'company',
      title: '회사와 연락처를 등록하세요',
      why: '딜은 회사에 붙습니다. 회사가 없으면 딜을 만들 수 없어요.',
      done: companies > 0,
      // 조수사는 용어집이 정한다 — 화면·서비스가 고르면 같은 개체가 곳/개로 갈린다
      status: companies > 0 ? `${count('company', companies)}이 등록돼 있어요` : '아직 한 곳도 없어요',
      action: { label: '엑셀로 한 번에 올리기', href: '/crm/settings' },
      alt: { label: '하나씩 만들기', href: '/crm/companies' },
    },
    {
      id: 'deal',
      title: '첫 딜을 만들어 보세요',
      why: '진행 중인 영업 건을 딜로 만들면 단계별로 어디까지 왔는지 보입니다.',
      done: deals > 0,
      status: deals > 0 ? `진행 중인 ${count('deal', deals)}` : '아직 딜이 없어요',
      // 「딜 만들기」는 금지어다 — 새로 만드는 진입은 「새 {개체}」 (용어집 §02)
      action: { label: createLabel(ENTITY.deal.label), href: '/crm/deals' },
    },
  ]

  const doneCount = steps.filter((s) => s.done).length
  return {
    steps,
    doneCount,
    complete: doneCount === steps.length,
    // 다음에 할 것 하나만 짚는다 — 넷을 다 읽게 하면 아무것도 안 한다
    current: steps.find((s) => !s.done)?.id ?? null,
  }
}

