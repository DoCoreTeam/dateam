// 국가명(한글/영문) → 국기 이모지. 공급사 국가 표시용.

const FLAG: Record<string, string> = {
  '미국': '🇺🇸', 'usa': '🇺🇸', 'us': '🇺🇸', 'united states': '🇺🇸',
  '한국': '🇰🇷', '대한민국': '🇰🇷', 'korea': '🇰🇷', 'south korea': '🇰🇷',
  '일본': '🇯🇵', 'japan': '🇯🇵',
  '대만': '🇹🇼', 'taiwan': '🇹🇼',
  '중국': '🇨🇳', 'china': '🇨🇳',
  '싱가포르': '🇸🇬', 'singapore': '🇸🇬',
  '영국': '🇬🇧', 'uk': '🇬🇧', 'united kingdom': '🇬🇧',
  '독일': '🇩🇪', 'germany': '🇩🇪',
  '프랑스': '🇫🇷', 'france': '🇫🇷',
  '네덜란드': '🇳🇱', 'netherlands': '🇳🇱',
  '캐나다': '🇨🇦', 'canada': '🇨🇦',
  '인도': '🇮🇳', 'india': '🇮🇳',
  '홍콩': '🇭🇰', 'hong kong': '🇭🇰',
  '호주': '🇦🇺', 'australia': '🇦🇺',
}

/** 국가명 → 국기 이모지 (모르면 빈 문자열) */
export function countryFlag(country: string | null | undefined): string {
  if (!country) return ''
  const key = country.trim().toLowerCase()
  if (FLAG[country.trim()]) return FLAG[country.trim()]
  return FLAG[key] ?? '🌐'
}
