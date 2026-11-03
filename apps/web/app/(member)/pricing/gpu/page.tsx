import { redirect } from 'next/navigation'
import GpuBoardClient from './board/GpuBoardClient'
import { createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { getBranding } from '@/lib/branding'
import { BOARD_COPY } from '@/lib/gpu/board-copy'

// GPU 한 장 화면. 옛 탭 화면은 /pricing/gpu/manage 로 옮겼고 ?tab= 주소는 그리로 넘긴다
const MANAGE_PATH = '/pricing/gpu/manage'

export async function generateMetadata() {
  const { brandName } = await getBranding()
  return { title: `${BOARD_COPY.title} | ${brandName}` }
}

async function fetchIsAdmin(): Promise<boolean> {
  try {
    const user = await getRequestUser()
    if (!user) return false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (createAdminClient() as any)
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    return data?.role === 'admin'
  } catch {
    return false
  }
}

type SearchParams = Record<string, string | string[] | undefined>

function toQuery(sp: SearchParams): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, one)
  }
  return q.toString()
}

export default async function GpuPricingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  if (sp.tab !== undefined) redirect(`${MANAGE_PATH}?${toQuery(sp)}`)
  return <GpuBoardClient isAdmin={await fetchIsAdmin()} />
}
