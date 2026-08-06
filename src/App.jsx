import { useMemo, useState } from 'react'
import { GINOU_JISSHU, TOKUTEI_GINOU, SOURCES } from './data.js'
import { computeQuota, HEARING_CHECKLIST, NOTES } from './sales.js'
import { expandTokens, rowMatches } from './synonyms.js'
import { STAGES, PLAN_RULES, SHINSA, EXAM_NOTE, SYSTEM_SOURCES } from './system.js'

// 制度（一覧モードのタブ）
const SYSTEMS = {
  jisshu: {
    key: 'jisshu', label: '技能実習', data: GINOU_JISSHU, sources: SOURCES.ginouJisshu,
    note: '移行対象職種・作業（出典：JITCO 令和8年4月10日時点）', unit: '職種',
  },
  tokutei: {
    key: 'tokutei', label: '特定技能', data: TOKUTEI_GINOU, sources: SOURCES.tokuteiGinou,
    note: '特定産業分野と主な業務区分（出典：出入国在留管理庁）', unit: '区分',
  },
}

// 分野データ → フラットな行に変換
function flatten(data) {
  const rows = []
  data.forEach((g) => g.jobs.forEach((j) => rows.push({ field: g.field, job: j.job, tasks: j.tasks })))
  return rows
}

const JISSHU_ROWS = flatten(GINOU_JISSHU)
const JISSHU_FIELDS = GINOU_JISSHU.map((d) => d.field)

// 検索語ハイライト
function Highlight({ text, term }) {
  if (!term) return text
  const i = text.toLowerCase().indexOf(term.toLowerCase())
  if (i < 0) return text
  return (<>{text.slice(0, i)}<mark>{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>)
}

// 作業名から画像／動画の検索URLを作る（末尾の「作業」は外して検索精度を上げる）
function taskSearch(task, job) {
  const base = task.replace(/作業$/, '').trim()
  const imgQ = encodeURIComponent(base)
  const vidQ = encodeURIComponent(base)
  return {
    img: `https://www.google.com/search?tbm=isch&q=${imgQ}`,
    video: `https://www.youtube.com/results?search_query=${vidQ}`,
  }
}

// 職種カード
function JobCard({ row, term }) {
  return (
    <div className="card">
      <p className="job"><Highlight text={row.job} term={term} /></p>
      {row.tasks.length ? (
        <ul className="tasks">
          {row.tasks.map((t) => {
            const s = taskSearch(t, row.job)
            return (
              <li className="task-item" key={t}>
                <span className="task-name"><Highlight text={t} term={term} /></span>
                <span className="task-links">
                  <a href={s.img} target="_blank" rel="noopener noreferrer" title={`「${t}」の画像を検索`}>🖼 画像</a>
                  <a href={s.video} target="_blank" rel="noopener noreferrer" title={`「${t}」の動画を検索`}>▶ 動画</a>
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="note">作業区分の詳細は公式一覧を参照</div>
      )}
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState('shindan') // 'shindan' | 'ichiran'

  return (
    <>
      <header>
        <div className="wrap">
          <div className="tabs">
            <button className={mode === 'shindan' ? 'tab on' : 'tab'} onClick={() => setMode('shindan')}>受入れ診断</button>
            <button className={mode === 'ichiran' ? 'tab on' : 'tab'} onClick={() => setMode('ichiran')}>職種一覧</button>
            <button className={mode === 'seido' ? 'tab on' : 'tab'} onClick={() => setMode('seido')}>制度のしくみ</button>
          </div>
          {mode === 'shindan' && (
            <>
              <h1>技能実習 受入れ診断</h1>
              <p className="lead">「製造業で技能実習生を雇える？」に答えるための営業ツール。作業内容から受入れ可否と職種を判定します。</p>
            </>
          )}
          {mode === 'ichiran' && (
            <>
              <h1>職種・分野一覧</h1>
              <p className="lead">技能実習・特定技能の対象職種／分野をキーワード検索できます。</p>
            </>
          )}
          {mode === 'seido' && (
            <>
              <h1>制度のしくみ</h1>
              <p className="lead">実習計画・審査基準・試験基準など、商談で説明できる基礎知識をまとめました。</p>
            </>
          )}
        </div>
      </header>
      <main>
        <div className="wrap-main">
          {mode === 'shindan' && <Shindan />}
          {mode === 'ichiran' && <Ichiran />}
          {mode === 'seido' && <Seido />}
        </div>
      </main>
      <footer>
        <span>正確・最新の内容は公式情報をご確認ください：</span>
        <a href={SOURCES.ginouJisshu[0].url} target="_blank" rel="noopener noreferrer">JITCO 職種・作業一覧</a>
        {' ／ '}
        <a href={SOURCES.ginouJisshu[1].url} target="_blank" rel="noopener noreferrer">外国人技能実習機構（OTIT）</a>
        {' ／ '}
        <a href={SOURCES.tokuteiGinou[0].url} target="_blank" rel="noopener noreferrer">出入国在留管理庁 特定技能</a>
      </footer>
    </>
  )
}

// ============================================================
// 受入れ診断モード
// ============================================================
function Shindan() {
  const [field, setField] = useState(null) // 選んだ分野
  const [term, setTerm] = useState('') // 作業キーワード
  const [staff, setStaff] = useState('') // 常勤職員数
  const [checked, setChecked] = useState({})

  // ステップ1・2で職種を絞り込む（あいまい検索：類義語も拾う）
  const tokens = useMemo(() => expandTokens(term), [term])
  const matches = useMemo(() => {
    let rows = JISSHU_ROWS
    if (field) rows = rows.filter((r) => r.field === field)
    if (tokens.length) rows = rows.filter((r) => rowMatches(r, tokens))
    return rows
  }, [field, tokens])

  // 判定：キーワードか分野で絞った結果、該当があるか
  const hasQuery = Boolean(field || term.trim())
  const quota = computeQuota(staff)

  // 分野ごとにグループ化
  const grouped = useMemo(() => {
    const by = {}
    matches.forEach((r) => { (by[r.field] ??= []).push(r) })
    return JISSHU_FIELDS.map((f) => ({ field: f, list: by[f] })).filter((g) => g.list)
  }, [matches])

  return (
    <div className="shindan">
      {/* ステップ1：分野選択 */}
      <section className="step">
        <div className="step-head"><span className="step-no">1</span>御社の仕事に近い分野は？</div>
        <div className="filters">
          <button className={field === null ? 'on' : ''} onClick={() => setField(null)}>指定しない</button>
          {JISSHU_FIELDS.map((f) => (
            <button key={f} className={field === f ? 'on' : ''} onClick={() => setField(field === f ? null : f)}>{f}</button>
          ))}
        </div>
      </section>

      {/* ステップ2：作業キーワード */}
      <section className="step">
        <div className="step-head"><span className="step-no">2</span>具体的な作業内容は？（キーワード）</div>
        <div className="searchbox">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="例：溶接、機械加工、めっき、塗装、プラスチック成形 …" autoComplete="off" />
          {term && (<button className="clear" aria-label="クリア" onClick={() => setTerm('')}>×</button>)}
        </div>
        <p className="hint">あいまいな言葉でもOK（例：ホテル→宿泊、掃除→ビルクリーニング、車→自動車整備、樹脂→プラスチック成形）</p>

        {/* 判定結果 */}
        {hasQuery && (
          matches.length > 0 ? (
            <div className="verdict ok">
              ✅ <b>受入れできる見込み</b>：該当する移行対象職種が <b>{matches.length}件</b> あります（2号への移行対象＝最長3年）。
            </div>
          ) : (
            <div className="verdict ng">
              ⚠️ その条件では<b>移行対象職種が見つかりません</b>。作業内容をより具体的に確認してください。移行対象外だと1号（1年）のみ、または受入れが難しい可能性があります。
            </div>
          )
        )}
      </section>

      {/* 該当職種カード */}
      {hasQuery && grouped.length > 0 && (
        <section className="step">
          <div className="step-head"><span className="step-no">✓</span>該当する職種・作業</div>
          {grouped.map((g) => (
            <div className="group" key={g.field}>
              <h2>{g.field}<span className="n">{g.list.length}職種</span></h2>
              <div className="grid">{g.list.map((r) => (<JobCard key={r.field + r.job} row={r} term={term} />))}</div>
            </div>
          ))}
        </section>
      )}

      {/* ステップ3：人数枠 */}
      <section className="step">
        <div className="step-head"><span className="step-no">3</span>常勤職員数から受入れ人数枠を概算</div>
        <div className="staff-input">
          <input type="number" min="1" value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="常勤職員数を入力（例：50）" />
          <span>人</span>
        </div>
        {quota && (
          <div className="quota">
            <div className="quota-row"><span>第1号・1年あたりの基本人数枠</span><b>{quota.base}人</b></div>
            <div className="quota-row"><span>1号+2号を満了在籍させた場合の目安（在籍上限）</span><b>{quota.withNiGou}人</b></div>
            <div className="quota-row"><span>優良認定を受けた場合（1号・1年）</span><b>{quota.yuryo}人</b></div>
            <p className="note">※団体監理型の一般的な目安。優良認定・職種等で変わります。最終確認は監理団体へ。</p>
          </div>
        )}
      </section>

      {/* ヒアリングチェックリスト */}
      <section className="step">
        <div className="step-head"><span className="step-no">4</span>ヒアリングチェックリスト</div>
        <ul className="checklist">
          {HEARING_CHECKLIST.map((item, i) => (
            <li key={i} className={checked[i] ? 'done' : ''}>
              <label>
                <input type="checkbox" checked={!!checked[i]} onChange={() => setChecked((c) => ({ ...c, [i]: !c[i] }))} />
                <span className="ci-q">{item.q}</span>
              </label>
              <p className="ci-hint">{item.hint}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 注意点 */}
      <section className="step">
        <div className="step-head"><span className="step-no">!</span>注意点</div>
        <ul className="notes">{NOTES.map((n, i) => (<li key={i}>{n}</li>))}</ul>
      </section>
    </div>
  )
}

// ============================================================
// 職種一覧モード（技能実習／特定技能の検索）
// ============================================================
function Ichiran() {
  const [systemKey, setSystemKey] = useState('jisshu')
  const [term, setTerm] = useState('')
  const [activeField, setActiveField] = useState(null)

  const system = SYSTEMS[systemKey]
  const fields = useMemo(() => system.data.map((d) => d.field), [system])
  const allRows = useMemo(() => flatten(system.data), [system])

  const tokens = useMemo(() => expandTokens(term), [term])
  const rows = useMemo(() => {
    let r = allRows
    if (activeField) r = r.filter((x) => x.field === activeField)
    if (tokens.length) r = r.filter((x) => rowMatches(x, tokens))
    return r
  }, [allRows, activeField, tokens])

  const grouped = useMemo(() => {
    const by = {}
    rows.forEach((r) => { (by[r.field] ??= []).push(r) })
    return fields.map((f) => ({ field: f, list: by[f] })).filter((g) => g.list)
  }, [rows, fields])

  function switchSystem(key) { setSystemKey(key); setActiveField(null); setTerm('') }

  return (
    <div className="ichiran">
      <div className="subtabs">
        {Object.values(SYSTEMS).map((s) => (
          <button key={s.key} className={s.key === systemKey ? 'on' : ''} onClick={() => switchSystem(s.key)}>{s.label}</button>
        ))}
      </div>
      <p className="lead">{system.note}</p>

      <div className="searchbox">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="例：溶接、介護、建築、水産、めっき …" autoComplete="off" />
        {term && (<button className="clear" aria-label="クリア" onClick={() => setTerm('')}>×</button>)}
      </div>

      <div className="filters">
        <button className={activeField === null ? 'on' : ''} onClick={() => setActiveField(null)}>すべて</button>
        {fields.map((f) => (<button key={f} className={activeField === f ? 'on' : ''} onClick={() => setActiveField(activeField === f ? null : f)}>{f}</button>))}
      </div>

      <div className="count">{rows.length} {system.unit} / 全 {allRows.length} {system.unit}</div>

      {grouped.length === 0 ? (
        <div className="empty">「{term}」に一致する{system.unit}は見つかりませんでした。</div>
      ) : (
        grouped.map((g) => (
          <section className="group" key={g.field}>
            <h2>{g.field}<span className="n">{g.list.length}{system.unit}</span></h2>
            <div className="grid">{g.list.map((r) => (<JobCard key={r.field + r.job} row={r} term={term} />))}</div>
          </section>
        ))
      )}
    </div>
  )
}

// ============================================================
// 制度のしくみモード（実習計画・審査基準・試験基準）
// ============================================================
function Seido() {
  return (
    <div className="seido">
      {/* 実習の段階と試験 */}
      <section className="step">
        <div className="step-head"><span className="step-no">A</span>実習の段階（号）と修了時の試験</div>
        <p className="note">技能実習は最長5年。各段階の修了時に試験があり、合格が次の段階へ進む条件です。</p>
        <div className="stage-list">
          {STAGES.map((s) => (
            <div className="stage" key={s.gou}>
              <div className="stage-head">
                <b>{s.gou}</b>
                <span className="stage-years">{s.years}</span>
              </div>
              <div className="stage-exam"><span className="tag">試験</span>{s.exam}</div>
              <p className="stage-note">{s.note}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 実習計画の業務区分 */}
      <section className="step">
        <div className="step-head"><span className="step-no">B</span>技能実習計画の業務区分（時間の割合ルール）</div>
        <p className="note">実習計画では業務を次のように区分し、時間の割合が決められています。</p>
        <div className="rule-list">
          {PLAN_RULES.map((r) => (
            <div className={'rule ' + r.cls} key={r.type}>
              <div className="rule-top">
                <b>{r.type}</b>
                <span className="rule-ratio">{r.ratio}</span>
              </div>
              <p className="rule-desc">{r.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 審査基準 */}
      <section className="step">
        <div className="step-head"><span className="step-no">C</span>審査基準（認定基準）とは</div>
        <p className="note">{SHINSA.desc}</p>
        <ul className="notes">{SHINSA.points.map((p, i) => (<li key={i}>{p}</li>))}</ul>
      </section>

      {/* 試験基準 */}
      <section className="step">
        <div className="step-head"><span className="step-no">D</span>試験基準（技能検定・技能実習評価試験）</div>
        <ul className="notes">{EXAM_NOTE.map((p, i) => (<li key={i}>{p}</li>))}</ul>
      </section>

      {/* 職種別の公式資料へのリンク */}
      <section className="step">
        <div className="step-head"><span className="step-no">→</span>職種ごとの詳しい審査基準・試験基準</div>
        <p className="note">具体的な必須業務・試験内容は職種ごとに異なります。公式の職種別資料で確認してください。</p>
        <div className="link-list">
          {SYSTEM_SOURCES.map((s) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" className="doclink">{s.label} ↗</a>
          ))}
        </div>
      </section>
    </div>
  )
}
