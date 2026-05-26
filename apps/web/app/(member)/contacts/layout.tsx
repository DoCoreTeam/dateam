import { requireAdmin } from '@/lib/auth/requireAdmin'

export default async function ContactsLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return <>{children}</>
}
