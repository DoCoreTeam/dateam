import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { readFileSync } from 'fs'
import { join } from 'path'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '인증 필요' }, { status: 401 })
  }

  const html = readFileSync(join(process.cwd(), 'dashboard.html'), 'utf-8')
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
