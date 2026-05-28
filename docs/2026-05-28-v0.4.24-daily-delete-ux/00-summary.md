# v0.4.24: 일일업무 삭제 UX 개선

## 작업 요약

일일업무 삭제 플로우 3가지 개선:
1. `window.confirm()` → 커스텀 확인 모달
2. 삭제 후 목록 즉시 반영 (HTTP 캐시 버그 수정)
3. 삭제 결과 토스트 알림

## 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `apps/web/app/(member)/daily/page.tsx` | 커스텀 모달 + 토스트 상태 추가, `handleDelete` / `handleDeleteConfirm` 분리, `DeleteConfirmModal` 컴포넌트 추가 |
| `apps/web/app/globals.css` | `.toast-container`, `.toast`, `.toast-success`, `.toast-error`, `.confirm-modal-*` CSS 추가 |
| `apps/web/app/api/daily/logs/route.ts` | `Cache-Control: private, max-age=30` → `no-store` |

## 버그 원인 (삭제 즉시 미반영)

`/api/daily/logs` 엔드포인트가 `Cache-Control: private, max-age=30`을 반환하고 있었음.  
SWR `mutate()` 후에도 브라우저가 30초간 캐시된 응답을 반환해 삭제된 항목이 계속 보였음.  
→ `no-store`로 변경해 매 요청마다 신선한 데이터를 가져오도록 수정.

## 구현 방식

- **Optimistic update**: 삭제 확정 즉시 SWR 캐시에서 해당 항목 필터링(`revalidate: false`)
- **Server action**: 백그라운드에서 실제 삭제 수행
- **Toast**: 서버 응답 후 성공/실패에 따라 3초간 표시

## 영향 범위

- 일일업무 페이지 삭제 플로우만 변경
- 기존 CRUD (생성/수정/조회) 로직 무변경
