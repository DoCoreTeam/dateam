// 회의록 내보내기 실패를 사람이 읽을 사유로 바꾸는 SSOT.
// 라우트가 아니라 여기 사는 이유: Next 라우트 파일은 핸들러 외 export를 허용하지 않는다(타입 에러).
// "잠시 후 다시 시도"로 뭉개면 사용자도 우리도 원인을 영영 못 본다 — 사유를 갈라서 준다.

export function exportFailureMessage(format: 'pdf' | 'png', err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  const label = format.toUpperCase()
  // 서버리스에서 크로미움 바이너리를 못 찾는 경우 — 배포 설정 문제지 일시 장애가 아니다.
  if (raw.includes('could not find') || raw.includes('enoent') || raw.includes('executablepath') || raw.includes('spawn')) {
    return `${label} 변환기(브라우저 엔진)를 서버에서 찾지 못했습니다. 배포 설정을 확인해 주세요.`
  }
  if (raw.includes('headless render disabled')) {
    return `이 환경에서는 ${label} 내보내기가 비활성화되어 있습니다.`
  }
  if (raw.includes('timeout') || raw.includes('timed out')) {
    return `${label} 생성이 제한 시간을 넘었습니다. 회의록이 너무 길지 않은지 확인해 주세요.`
  }
  return `${label} 생성에 실패했습니다. 관리자에게 문의해 주세요.`
}
