// ============================================================
// フロント側は「URL/会社名をバックエンドに投げて結果を受け取る」だけ。
//   AIの呼び出し・ウェブ検索・APIキーの保持はすべてサーバー(server/index.mjs)側。
//   → 利用者はキー入力不要。URLか会社名を入れるだけ。
//
//   APIの場所：既定は同一オリジンの /api/analyze。
//   別ホストのサーバーを使う場合はビルド時に VITE_API_BASE で指定。
//   例: VITE_API_BASE=https://api.example.com npm run build
// ============================================================
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

export async function analyze(query) {
  const q = (query || '').trim()
  if (!q) throw new Error('URLまたは会社名を入力してください。')

  let res
  try {
    res = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    })
  } catch {
    throw new Error('サーバーに接続できませんでした。バックエンドが起動しているか確認してください。')
  }

  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data && data.error) || `エラーが発生しました（${res.status}）。`)
  return normalize(data)
}

function normalize(obj) {
  const o = obj || {}
  o.summary = o.summary || ''
  o.sources = Array.isArray(o.sources) ? o.sources : []
  o.systems = Array.isArray(o.systems) ? o.systems : []
  o.questions = Array.isArray(o.questions) ? o.questions : []
  o.caveats = Array.isArray(o.caveats) ? o.caveats : []
  o.systems.forEach((s) => {
    s.candidates = Array.isArray(s.candidates) ? s.candidates : []
    s.candidates.forEach((c) => { c.tasks = Array.isArray(c.tasks) ? c.tasks : [] })
  })
  return o
}
