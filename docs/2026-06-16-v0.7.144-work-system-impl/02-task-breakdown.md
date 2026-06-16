# 02 작업 분해
A1 일일 API 3곳+getDailyLogs personal 필터 / A2 승격 API+UI(일일→부서 참조)
B1 group-by API / B2 그룹핑 뷰 UI(축 토글)
C1 dashboard API / C2 대시보드 위젯 3종
D1 useDraft 훅+테스트 / D2 useUndoable 훅+테스트 / D3 useFormCore 합본+단축키 / D4 주요 입력면 적용(일일·거래처·딜·부서모달·캘린더 등) / D5 복원배너 공용 컴포넌트
검증: 각 단위테스트 + Playwright(역류제거·승격·그룹뷰·대시보드·임시저장 새로고침·undo) + 실데이터.
