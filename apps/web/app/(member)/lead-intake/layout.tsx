import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function LeadIntakeLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <>{children}</>
}
