import { requireAdmin } from '@/lib/auth/requireAdmin'
import SystemLogClient from './SystemLogClient'

export const dynamic = 'force-dynamic'

export default async function SystemLogPage() {
  await requireAdmin()
  return <SystemLogClient />
}
