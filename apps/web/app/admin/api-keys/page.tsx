import { redirect } from 'next/navigation'

export default function AdminApiKeysRedirect() {
  redirect('/admin/api?tab=keys')
}
