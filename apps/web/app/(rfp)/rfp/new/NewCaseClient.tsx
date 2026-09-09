'use client'

// 올리고 나면 리포트로 보낸다 — 올린 뒤 이 화면에 남아 있으면
// 사용자는 「다음에 뭘 하지」를 스스로 알아내야 한다.

import { useRouter } from 'next/navigation'
import UploadPanel from '@/components/rfp/UploadPanel'

export default function NewCaseClient() {
  const router = useRouter()
  return <UploadPanel onDone={(id) => router.push(`/rfp/${id}`)} />
}
