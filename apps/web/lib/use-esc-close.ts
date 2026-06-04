import { useEffect } from 'react'

// 모달 ESC 닫기 공용 훅. enabled=false면 비활성(중첩 모달에서 자식이 먼저 닫히도록).
export function useEscClose(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, enabled])
}
