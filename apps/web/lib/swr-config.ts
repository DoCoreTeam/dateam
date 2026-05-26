export const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { const json = await res.json(); msg = json?.error ?? msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}
