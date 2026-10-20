/**
 * GPU 가격표를 읽어 GPU 이용 줄의 정상가 찾기를 만든다 (서버 전용)
 *
 * GPU 가격표는 Supabase 쪽 표라 CRM 의 Prisma 범위 밖에 있다. 가격표 화면과 같은 읽기(`getGpuCatalog`)를 쓴다.
 * 서비스롤로 읽으므로 이 함수는 사람 확인을 지난 창구(글로 채우기, MEMBER)에서만 부른다.
 * 읽기만 한다. 원가는 돌려주지 않는다 — 판매가와 장수만.
 */

import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { getGpuCatalog } from '@/lib/gpu/pricing'
import type { GpuPriceRef } from '../domain/pricebook/basis-lines.ts'
import { buildGpuPriceLookup } from './gpu-price-ref.ts'

export async function loadGpuPriceLookup(): Promise<(model: string) => GpuPriceRef | null> {
  const catalog = await getGpuCatalog(createAdminClient())
  return buildGpuPriceLookup(catalog.products)
}
