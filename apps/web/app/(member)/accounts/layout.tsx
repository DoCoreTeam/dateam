import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function AccountsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <>{children}</>
}
