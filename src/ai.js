// ============================================================
// 企業HP → 制度別「該当候補＋証拠の強さ」を出す AI 診断ロジック
//   ※ 出せるのは「業種の当たり」まで。実際の可否は個々の外国人が
//     従事する具体的作業・必須業務比率で決まり、HPには載っていない。
//     よって「確率」ではなく「証拠の強さ（強/中/弱）」を返す。
//   ※ 今回の対象は技能実習・特定技能のみ（技人国は対象外）。
// ============================================================
import Anthropic from '@anthropic-ai/sdk'
import { GINOU_JISSHU, TOKUTEI_GINOU } from './data.js'

// 選べるモデル（いずれも adaptive thinking / effort に対応）
export const MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5（高精度・高コスト）' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5（バランス・低コスト）' },
]

const LS_KEY = 'anthropicApiKey'
const LS_MODEL = 'aiModel'

export function loadKey() {
  try { return localStorage.getItem(LS_KEY) || '' } catch { return '' }
}
export function saveKey(v) {
  try { v ? localStorage.setItem(LS_KEY, v) : localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
}
export function loadModel() {
  try { return localStorage.getItem(LS_MODEL) || MODELS[0].id } catch { return MODELS[0].id }
}
export function saveModel(v) {
  try { localStorage.setItem(LS_MODEL, v) } catch { /* ignore */ }
}

// data.js の公式リストを、LLM に「選択肢」として渡すためのテキストに変換。
// これにより存在しない職種を作り出す（幻覚）のを防ぐ。
function taxonomyText() {
  const block = (title, data) => {
    const lines = data.map((g) =>
      g.jobs.map((j) => `- ${g.field} ＞ ${j.job}：${j.tasks.join(' / ')}`).join('\n'),
    ).join('\n')
    return `【${title}】\n${lines}`
  }
  return [
    block('技能実習の対象職種・作業（移行対象）', GINOU_JISSHU),
    block('特定技能の分野・業務区分', TOKUTEI_GINOU),
  ].join('\n\n')
}

const SYSTEM_PROMPT = `あなたは、日本の外国人材受入れ制度（技能実習・特定技能）の営業を支援するアシスタントです。
企業のホームページ本文から「その企業が受入れを検討できそうな制度・分野・作業の候補」を、根拠とともに提示します。

# 絶対に守るルール
1. 候補は必ず後述の「対象職種・作業リスト」に載っている field / job / tasks の中からのみ選ぶこと。リストに無い職種・分野を新しく作らない。
2. ホームページから分かるのは「業種の当たり」までである。在留資格の可否は、実際に外国人が従事する具体的作業・必須業務の比率・受入れ体制で決まり、HPには通常載っていない。したがって「確率○%」のような断定はしない。代わりに証拠の強さを "強" / "中" / "弱" の3段階で示す。
   - 強：HP本文に、その作業・製品・工程が明確に記述されている
   - 中：業種・事業内容から妥当に推測できるが、直接の記述は乏しい
   - 弱：可能性はあるが根拠が薄い、または付随的
3. 各候補には evidence（判断の根拠。HP本文の該当箇所を短く引用または要約。推測の場合は「推測」と明記）を必ず付ける。
4. 単純作業・事務・営業のみが読み取れる場合は、無理に候補を挙げず、その旨を caveats に書く。
5. 技能実習と特定技能で、同じ作業でも分野名・区分が異なる点に注意する。両制度それぞれについて候補を出す。
6. 出力は指定のJSONのみ。前後に説明文やコードフェンスを付けない。

# 出力JSONの形式
{
  "summary": "この企業の事業内容の要約（1〜3文）",
  "systems": [
    {
      "system": "技能実習",
      "candidates": [
        { "field": "分野名", "job": "職種名", "tasks": ["作業", "..."], "strength": "強|中|弱", "evidence": "根拠（HP該当箇所の引用/要約、または推測の旨）" }
      ]
    },
    {
      "system": "特定技能",
      "candidates": [ ... 同上 ... ]
    }
  ],
  "questions": ["受入れ可否を詰めるために、企業に確認すべき質問（3〜6個）"],
  "caveats": ["この診断の限界・注意点（必ず『HPからは業種の当たりまで。可否は個別確認が必要』を含める）"]
}

候補は各制度とも証拠の強い順に、最大6件まで。該当が無い制度は candidates を空配列にする。`

// r.jina.ai リーダープロキシで HP 本文を取得（CORS 回避＋本文抽出）。
// ※ 対象URLを第三者(jina.ai)に送信する点に注意（＝公開URLの取得のみ想定）。
export async function fetchSiteText(url) {
  const raw = (url || '').trim()
  if (!raw) throw new Error('URLを入力してください。')
  const target = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const res = await fetch(`https://r.jina.ai/${target}`, {
    headers: { 'X-Return-Format': 'text' },
  })
  if (!res.ok) {
    throw new Error(`HP本文を取得できませんでした（${res.status}）。下の欄に本文を貼り付けて診断してください。`)
  }
  const text = await res.text()
  if (!text || text.trim().length < 40) {
    throw new Error('本文がほとんど取得できませんでした。JS描画のサイト等の可能性があります。本文を貼り付けてお試しください。')
  }
  return text.slice(0, 20000) // コスト・文脈長のため上限を設ける
}

// 本文をLLMで診断して構造化結果を返す
export async function analyze({ apiKey, model, companyText }) {
  if (!apiKey) throw new Error('APIキーを入力してください。')
  const body = (companyText || '').trim()
  if (body.length < 20) throw new Error('企業の事業内容（HP本文など）を入力してください。')

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })

  const userContent = `# 対象職種・作業リスト（この中からのみ候補を選ぶ）
${taxonomyText()}

# 診断対象の企業ホームページ本文
"""
${body.slice(0, 20000)}
"""

上記本文を読み、指定JSON形式で候補を出力してください。`

  const res = await client.messages.create({
    model: model || MODELS[0].id,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  })

  const textBlock = res.content.find((b) => b.type === 'text')
  const rawText = textBlock ? textBlock.text : ''
  return parseResult(rawText)
}

// LLM出力を防御的にパース（万一コードフェンス等が付いても救う）
function parseResult(text) {
  const tryParse = (s) => { try { return JSON.parse(s) } catch { return null } }
  let obj = tryParse(text)
  if (!obj) {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) obj = tryParse(m[0])
  }
  if (!obj) throw new Error('AIの応答を解析できませんでした。もう一度お試しください。')
  // 最低限の整形
  obj.summary = obj.summary || ''
  obj.systems = Array.isArray(obj.systems) ? obj.systems : []
  obj.questions = Array.isArray(obj.questions) ? obj.questions : []
  obj.caveats = Array.isArray(obj.caveats) ? obj.caveats : []
  obj.systems.forEach((s) => {
    s.candidates = Array.isArray(s.candidates) ? s.candidates : []
    s.candidates.forEach((c) => { c.tasks = Array.isArray(c.tasks) ? c.tasks : [] })
  })
  return obj
}
