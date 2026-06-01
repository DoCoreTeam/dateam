import { redirect } from 'next/navigation'

export default function AdminOrgChartRedirect() {
  redirect('/admin/members?tab=org')
}
