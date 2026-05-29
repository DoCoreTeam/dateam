# Test Strategy — GPU DB Chat

## Playwright E2E (3 케이스)
1. DB 기반 답변: "H100 최근 견적 알려줘" → answer 텍스트 존재 확인
2. 멀티턴: 후속 질문 → 앞 대화 참조한 답변 확인
3. 거절: "오늘 날씨 어때?" → 거절 키워드 포함 확인
