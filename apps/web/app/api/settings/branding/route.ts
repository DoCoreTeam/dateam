import { NextResponse } from 'next/server'
import { getBranding } from '@/lib/branding'

export async function GET() {
  const branding = await getBranding()
  return NextResponse.json(branding, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
