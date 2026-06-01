import { redirect } from 'next/navigation'

export default function AdminApiAccessRedirect() {
  redirect('/admin/api?tab=access')
}
