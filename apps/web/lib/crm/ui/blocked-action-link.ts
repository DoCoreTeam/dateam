/**
 * 막힌 안내 옆에 붙일 「고치러 가기」 단추의 짝 — 안내문과 목적지를 한 자리에서 잇는다
 *
 * **왜 따로 있나**: 「설정의 계약 탭에서 템플릿을 발행해 주세요」만 적고 단추가 없으면
 * 사용자는 설정을 찾아 들어가 탭을 고르고 카드를 찾아야 한다(사용자 지적 2026-10-19
 * 「이런거 나올때 버튼으로 바로 이동해서 할 수 있게 하는게 기본」).
 * 같은 안내가 화면에서 먼저 나기도 하고 서버 오류로 돌아오기도 해서, 문구로 짝을 찾는다.
 */

import { CONTRACT_MSG, CONTRACT_TEMPLATE } from '../../terms/contract-doc.ts'
import { crmSettingsHref } from '../domain/settings-tab.ts'

export interface BlockedActionLink {
  href: string
  label: string
}

const CONTRACT_TEMPLATES: BlockedActionLink = {
  href: crmSettingsHref('contract'),
  label: CONTRACT_TEMPLATE.goCreate,
}

const LINKS: ReadonlyMap<string, BlockedActionLink> = new Map([
  [CONTRACT_MSG.noTemplate, CONTRACT_TEMPLATES],
  [CONTRACT_MSG.templateNotPublished, CONTRACT_TEMPLATES],
])

/** 이 안내를 풀러 갈 곳. 갈 곳이 없는 안내면 null */
export function blockedActionLink(message: string | null | undefined): BlockedActionLink | null {
  return message ? LINKS.get(message) ?? null : null
}
