import 'server-only'
import { cache } from 'react'
import { canOpen } from '@/lib/access/guard'
import { resolveCrmAccess } from './requireCrmMember'
import { decideMeetingEntry } from './meeting-entry'

/**
 * 이 사람은 회의를 CRM 에서 적나.
 *
 * 레이아웃과 홈이 한 요청에서 같이 묻는다. `cache` 로 묶어 CRM 멤버 조회는 요청당 한 번이다.
 *
 * **조회가 실패하면 회의노트로 보낸다.** CRM 저장소가 잠깐 안 닿는다고
 * 화면 전체(이 판정을 부르는 레이아웃)가 죽으면 안 되고, 모르는 채로 CRM 을 열어 주지도 않는다.
 */
export const hasCrmMeetingAccess = cache(async (): Promise<boolean> => {
  try {
    const [canOpenCrm, access] = await Promise.all([canOpen('/crm'), resolveCrmAccess()])
    return decideMeetingEntry({ canOpenCrm, isCrmMember: access.ok }) === 'crm'
  } catch (e) {
    console.error('[hasCrmMeetingAccess] CRM 권한 조회 실패, 회의노트로 보냄', e)
    return false
  }
})
