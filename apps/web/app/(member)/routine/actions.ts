'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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
