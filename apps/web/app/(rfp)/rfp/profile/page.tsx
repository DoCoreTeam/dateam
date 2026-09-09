// /rfp/profile — 회사 프로필
//
// 적합도 판정이 이 정보를 쓴다. 초안은 draft 로만 저장되고
// 사람이 확인해야 판정에 쓰인다.
//
// **다섯 부분 전부**를 읽어 넘긴다(기본정보·실적·인증·기술·협력사).
// 예전에는 기본정보만 읽어서, 적합도를 실제로 가르는 넷이 화면에 없었다.

import PageHeader from '@/components/ui/PageHeader'
import { createClient } from '@/lib/supabase/server'
import { RFP_PROFILE, RFP_LIST } from '@/lib/rfp/terms'
import { loadProfile, missingForAssessment } from '@/lib/rfp/db/profile'
import ProfileEditor from '@/components/rfp/ProfileEditor'

export const dynamic = 'force-dynamic'

export default async function RfpProfilePage() {
  const db = await createClient()

  // 활성 판이 없으면 초안이라도 연다 — 안 그러면 사용자가 쓰던 것이 사라져 보인다
  let profile = null
  try {
    profile = (await loadProfile(db as never, { status: 'active' })) ?? (await loadProfile(db as never))
  } catch {
    // 프로필을 못 읽어도 화면은 열린다 — 빈 폼에서 새로 채울 수 있다
  }

  return (
    <main className="page-inner">
      <PageHeader
        title={RFP_PROFILE.title}
        description={RFP_PROFILE.desc}
        back={{ href: '/rfp', label: RFP_LIST.title }}
      />
      <ProfileEditor
        initial={profile?.basic ?? null}
        initialVersion={profile?.version ?? null}
        initialStatus={profile?.status ?? null}
        initialCertifications={profile?.certifications ?? []}
        initialTrackRecords={profile?.trackRecords ?? []}
        initialCapabilities={profile?.capabilities ?? []}
        initialPartners={profile?.partners ?? []}
        initialMissing={profile ? missingForAssessment(profile) : []}
      />
    </main>
  )
}
