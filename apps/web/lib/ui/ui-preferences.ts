// lib/ui/ui-preferences.ts — 서버에서 개인 목록 설정 읽기
// 화면(서버 컴포넌트)이 첫 렌더에 값을 갖고 시작해야 깜빡임이 없다.

import { createClient } from '@/lib/supabase/server'
import { sanitizeSavedPrefs, type SavedListPrefs } from './list-query'

export async function loadListPrefs(scopeKey: string): Promise<SavedListPrefs> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}

  const { data, error } = await supabase
    .from('ui_preferences')
    .select('value')
    .eq('user_id', user.id)
    .eq('scope_key', scopeKey)
    .maybeSingle()

  // 설정을 못 읽었다고 목록을 막지 않는다 — 화면 기본값으로 간다
  if (error || !data) return {}
  return sanitizeSavedPrefs((data as { value: unknown }).value)
}
