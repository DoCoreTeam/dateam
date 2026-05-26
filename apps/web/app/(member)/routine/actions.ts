'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getWeekStart, toDateString } from '@/lib/utils'
import { DEFAULT_ROUTINES } from '@/lib/routine-defaults'
import type { RoutineItemParsed } from '@/lib/routine-defaults'

type RoutineItemRaw = string | { name: string; freq?: 'daily' | 'weekly' }

function parseRoutineItems(items: RoutineItemRaw[]): RoutineItemParsed[] {
  return items.map((item) =>
    typeof item === 'string'
      ? { name: item, freq: 'weekly' as const }
      : { name: item.name, freq: item.freq ?? 'weekly' }
  )
}

export async function getRoutineWeeklyStatus() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const adminClient = createAdminClient()
  const weekStart = getWeekStart()
  const weekStartStr = toDateString(weekStart)

  const [rtRow, profileRow, checksRow] = await Promise.all([
    adminClient.from('org_content').select('value').eq('key', 'routine_templates').single() as unknown as Promise<{ data: { value: { name: string; items?: RoutineItemRaw[] }[] } | null }>,
    adminClient.from('profiles').select('name').eq('id', user.id).single() as unknown as Promise<{ data: { name: string | null } | null }>,
    supabase.from('routine_checks').select('routine_name').eq('user_id', user.id).eq('week_start', weekStartStr).eq('is_completed', true),
  ])

  const templates = Array.isArray(rtRow.data?.value) ? rtRow.data!.value : []
  const profileName = profileRow.data?.name ?? null
  const myTemplate = profileName ? templates.find((t) => t.name === profileName) : null

  const allItems: RoutineItemParsed[] =
    myTemplate?.items && myTemplate.items.length > 0
      ? parseRoutineItems(myTemplate.items)
      : DEFAULT_ROUTINES

  const weeklyItems = allItems.filter((i) => i.freq === 'weekly')
  const completedNames = new Set((checksRow.data ?? []).map((c: { routine_name: string }) => c.routine_name))
  const pendingCount = weeklyItems.filter((i) => !completedNames.has(i.name)).length

  return {
    weekStart: weekStartStr,
    weeklyItems,
    completedNames: Array.from(completedNames),
    pendingCount,
  }
}

export async function upsertRoutineCheck(
  routineName: string,
  checkDate: string,
  weekStart: string,
  isCompleted: boolean
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: '인증이 필요합니다' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('routine_checks') as any).upsert(
    {
      user_id: user.id,
      routine_name: routineName,
      check_date: checkDate,
      week_start: weekStart,
      is_completed: isCompleted,
    },
    {
      onConflict: 'user_id,routine_name,check_date',
    }
  )

  if (error) return { error: (error as { message: string }).message }

  revalidatePath('/routine')
  revalidatePath('/dashboard')
  return { success: true }
}
