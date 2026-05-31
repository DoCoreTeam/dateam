import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashApiKey } from '@/lib/apiKey'

export interface ApiKeyContext {
  userId: string
  keyId: string
  rateLimitPerMinute: number
}

export async function authenticatePublicApi(
  request: NextRequest
): Promise<{ ctx: ApiKeyContext } | { error: NextResponse }> {
  const authHeader = request.headers.get('x-api-key') ?? request.headers.get('authorization')
  let rawKey: string | null = null

  if (authHeader) {
    rawKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader
  }

  if (!rawKey || !rawKey.startsWith('ax_live_')) {
    return {
      error: NextResponse.json(
        { success: false, error: 'Missing or invalid API key. Provide X-API-Key header.' },
        { status: 401, headers: corsHeaders() }
      ),
    }
  }

  const hash = hashApiKey(rawKey)
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('api_keys')
    .select('id, user_id, revoked_at, rate_limit_per_minute')
    .eq('key_hash', hash)
    .single()

  if (error || !data) {
    return {
      error: NextResponse.json(
        { success: false, error: 'Invalid API key.' },
        { status: 401, headers: corsHeaders() }
      ),
    }
  }

  if (data.revoked_at) {
    return {
      error: NextResponse.json(
        { success: false, error: 'API key has been revoked.' },
        { status: 403, headers: corsHeaders() }
      ),
    }
  }

  // Update last_used_at and increment request_count (fire-and-forget)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(admin as any)
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString(), request_count: (data.request_count ?? 0) + 1 })
    .eq('id', data.id)
    .then(() => {})

  return {
    ctx: {
      userId: data.user_id,
      keyId: data.id,
      rateLimitPerMinute: data.rate_limit_per_minute ?? 60,
    },
  }
}

export function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
  }
}

export function optionsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
}
