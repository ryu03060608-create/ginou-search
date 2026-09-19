// ============================================================
// バックエンドAPI：URL/会社名 → Claude がウェブ検索して制度候補を返す
//   - APIキーはこのサーバーの環境変数 ANTHROPIC_API_KEY に置く（表に出さない）
//   - フロント(dist)も同じサーバーから配信 → 同一オリジンでCORS不要
//
//   起動:  ANTHROPIC_API_KEY=sk-ant-... npm start
//   （事前に npm run build で dist を作っておくこと）
// ============================================================
import express from 'express'
import cors from 'cors'
import Anthropic from '@anthropic-ai/sdk'
import { fileURLToPath } from 'url'
import path from 'path'
import { GINOU_JISSHU, TOKUTEI_GINOU } from '../src/data.js'

const PORT = process.env.PORT || 8787
const MODEL = process.env.AI_MODEL || 'claude-opus-5' // 低コストにするなら claude-sonnet-5
const apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey) {
  console.error('環境変数 ANTHROPIC_API_KEY が未設定です。例: ANTHROPIC_API_KEY=sk-ant-... npm start')
  process.exit(1)
}

const client = new Anthropic({ apiKey })
const here = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(here, '..', 'dist')

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// --- data.js の公式リストを「選択肢」として渡す（幻覚防止） ---
function taxonomyText() {
  const block = (title, data) =>
    `【${title}】\n` +
    data.map((g) => g.jobs.map((j) => `- ${g.field} ＞ ${j.job}：${j.tasks.join(' / ')}`).join('\n')).join('\n')
  return [
    block('技能実習の対象職種・作業（移行対象）', GINOU_JISSHU),
    block('特定技能の分野・業務区分', TOKUTEI_GINOU),
  ].join('\n\n')
}

const SYSTEM_PROMPT = `あなたは、日本の外国人材受入れ制度（技能実習・特定技能）の営業を支援するリサーチアシスタントです。
利用者が入力した企業のURLまたは会社名について、ウェブ検索・ページ取得ツールを使って事業内容を調べ、
「その企業が受入れを検討できそうな制度・分野・作業の候補」を根拠とともに提示します。

# 調べ方
- 入力がURLならそのページを web_fetch で読む。会社名なら web_search で公式サイト等を探し、必要に応じて web_fetch で読む。
- 事業内容・主要製品・工程・拠点・募集職種などが分かる情報を優先して集める。過度な検索はしない（合計5回程度まで）。

# 絶対に守るルール
1. 候補は必ず後述の「対象職種・作業リスト」に載っている field / job / tasks の中からのみ選ぶ。リストに無い職種・分野を新しく作らない。
2. 調べても分かるのは「業種の当たり」までである。在留資格の可否は、実際に外国人が従事する具体的作業・必須業務の比率・受入れ体制で決まる。よって「確率○%」のような断定はせず、証拠の強さを "強"/"中"/"弱" の3段階で示す。
   - 強：調べた情報に、その作業・製品・工程が明確に記述されている
   - 中：業種・事業内容から妥当に推測できるが直接の記述は乏しい
   - 弱：可能性はあるが根拠が薄い、または付随的
3. 各候補には evidence（判断の根拠。どの情報から言えるかを短く。可能なら出典サイト名やURLに触れる。推測なら「推測」と明記）を付ける。
4. 事業内容が特定できない／単純作業や事務のみの場合は、無理に候補を挙げず caveats に書く。
5. 技能実習と特定技能で分野名・区分が異なる点に注意し、両制度それぞれ候補を出す。
6. 最終的な出力は、下記JSONのみ。前後に説明文やコードフェンスを付けない。

# 出力JSON形式
{
  "summary": "調べて分かった事業内容の要約（1〜3文）",
  "sources": ["参照した主なURL"],
  "systems": [
    { "system": "技能実習", "candidates": [ { "field": "分野", "job": "職種", "tasks": ["作業"], "strength": "強|中|弱", "evidence": "根拠" } ] },
    { "system": "特定技能", "candidates": [ ... ] }
  ],
  "questions": ["受入れ可否を詰めるために企業へ確認すべき質問（3〜6個）"],
  "caveats": ["この診断の限界・注意点（必ず『調べて分かるのは業種の当たりまで。可否は個別確認が必要』を含める）"]
}
候補は各制度とも証拠の強い順に最大6件。該当が無い制度は candidates を空配列にする。`

function userPrompt(query) {
  return `# 対象職種・作業リスト（この中からのみ候補を選ぶ）
${taxonomyText()}

# 調べる対象
${query}

上記の企業についてツールで調べ、指定JSON形式で候補を出力してください。`
}

// ツールセットを段階的に試す（モデル/SDKのツール対応差に強くする）
const TOOL_SETS = [
  [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
  ],
  [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
  [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
  [], // 最後の保険：ツールなし（モデルの知識のみ）
]

async function runOnce(tools, query) {
  const messages = [{ role: 'user', content: userPrompt(query) }]
  // web検索は pause_turn を挟むことがあるので継続ループ
  for (let step = 0; step < 8; step++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      tools: tools.length ? tools : undefined,
      messages,
    })
    if (resp.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: resp.content })
      continue
    }
    const textBlock = [...resp.content].reverse().find((b) => b.type === 'text')
    return textBlock ? textBlock.text : ''
  }
  throw new Error('AIの処理が長すぎて完了しませんでした。もう一度お試しください。')
}

async function analyze(query) {
  let lastErr
  for (const tools of TOOL_SETS) {
    try {
      const text = await runOnce(tools, query)
      return parseResult(text)
    } catch (e) {
      lastErr = e
      // ツール非対応(400)なら次のツールセットへフォールバック。それ以外は即中断。
      if (e instanceof Anthropic.BadRequestError) continue
      throw e
    }
  }
  throw lastErr || new Error('診断に失敗しました。')
}

function parseResult(text) {
  const tryParse = (s) => { try { return JSON.parse(s) } catch { return null } }
  let obj = tryParse(text)
  if (!obj) { const m = text.match(/\{[\s\S]*\}/); if (m) obj = tryParse(m[0]) }
  if (!obj) throw new Error('AIの応答を解析できませんでした。もう一度お試しください。')
  obj.summary = obj.summary || ''
  obj.sources = Array.isArray(obj.sources) ? obj.sources : []
  obj.systems = Array.isArray(obj.systems) ? obj.systems : []
  obj.questions = Array.isArray(obj.questions) ? obj.questions : []
  obj.caveats = Array.isArray(obj.caveats) ? obj.caveats : []
  obj.systems.forEach((s) => {
    s.candidates = Array.isArray(s.candidates) ? s.candidates : []
    s.candidates.forEach((c) => { c.tasks = Array.isArray(c.tasks) ? c.tasks : [] })
  })
  return obj
}

app.post('/api/analyze', async (req, res) => {
  const query = (req.body?.query || '').trim()
  if (!query) return res.status(400).json({ error: 'URLまたは会社名を入力してください。' })
  try {
    res.json(await analyze(query))
  } catch (e) {
    console.error('[analyze]', e?.message || e)
    res.status(500).json({ error: e?.message || 'サーバーエラーが発生しました。' })
  }
})

app.get('/api/health', (_req, res) => res.json({ ok: true, model: MODEL }))

// フロント(dist)を配信。SPAなので不明パスは index.html を返す。
app.use(express.static(distDir))
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')))

app.listen(PORT, () => {
  console.log(`ginou-search server: http://localhost:${PORT}  (model: ${MODEL})`)
})
