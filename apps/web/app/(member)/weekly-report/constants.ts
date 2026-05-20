export const CATEGORIES = ['매출', '파이프라인', '기타'] as const
export type Category = (typeof CATEGORIES)[number]
