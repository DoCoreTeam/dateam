// 국가명(한글/영문) → 국기 이모지. 공급사 국가 표시용.

// 키는 소문자. 한글명·영문명·ISO 3166-1 alpha-2 코드(kr/us/jp…) 모두 매핑.
const FLAG: Record<string, string> = {
  '미국': '🇺🇸', 'usa': '🇺🇸', 'us': '🇺🇸', 'united states': '🇺🇸',
  '한국': '🇰🇷', '대한민국': '🇰🇷', 'korea': '🇰🇷', 'south korea': '🇰🇷', 'kr': '🇰🇷',
  '일본': '🇯🇵', 'japan': '🇯🇵', 'jp': '🇯🇵',
  '대만': '🇹🇼', 'taiwan': '🇹🇼', 'tw': '🇹🇼',
  '중국': '🇨🇳', 'china': '🇨🇳', 'cn': '🇨🇳',
  '싱가포르': '🇸🇬', 'singapore': '🇸🇬', 'sg': '🇸🇬',
  '영국': '🇬🇧', 'uk': '🇬🇧', 'gb': '🇬🇧', 'united kingdom': '🇬🇧',
  '독일': '🇩🇪', 'germany': '🇩🇪', 'de': '🇩🇪',
  '프랑스': '🇫🇷', 'france': '🇫🇷', 'fr': '🇫🇷',
  '네덜란드': '🇳🇱', 'netherlands': '🇳🇱', 'nl': '🇳🇱',
  '캐나다': '🇨🇦', 'canada': '🇨🇦', 'ca': '🇨🇦',
  '인도': '🇮🇳', 'india': '🇮🇳', 'in': '🇮🇳',
  '홍콩': '🇭🇰', 'hong kong': '🇭🇰', 'hk': '🇭🇰',
  '호주': '🇦🇺', 'australia': '🇦🇺', 'au': '🇦🇺',
}

/** 국가명 → 국기 이모지 (모르면 빈 문자열) */
export function countryFlag(country: string | null | undefined): string {
  if (!country) return ''
  const key = country.trim().toLowerCase()
  if (FLAG[country.trim()]) return FLAG[country.trim()]
  return FLAG[key] ?? '🌐'
}
