# FAST PATH v0.7.308
작업: 모델 선택이 반영 안 되던 버그 수정
대상: app/admin/ai-chat/AiChatClient.tsx handleChangeModel
이유: 새 대화 시 providers.find(provider)를 그대로 setDraftProvider해 프로바이더 기본모델이 선택 model을 덮어씀. 라벨만 취하고 선택 model 보존으로 수정.
영향: 표시 전용. 실브라우저로 gemini-2.5-pro 선택→하단 표시 갱신 확인. tsc 0.
