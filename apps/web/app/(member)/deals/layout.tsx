import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function DealsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <>{children}</>
}
