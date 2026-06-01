import { requireAdmin } from '@/lib/auth/requireAdmin'
import ProjectTabs from '@/components/ui/ProjectTabs'

export default async function ProjectLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()
  return (
    <>
      <ProjectTabs />
      {children}
    </>
  )
}
