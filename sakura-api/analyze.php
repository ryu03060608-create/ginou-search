<?php
// ============================================================
// さくらのレンタルサーバ（共用）向け AI診断バックエンド（PHP版）
//   URL/会社名 → Claude が web_search/web_fetch で調べて制度候補を返す。
//   APIキーは同ディレクトリの config.php（.htaccessで直アクセス禁止）に置く。
//   常駐プロセス不要（リクエストごとに動くので共用サーバーで可）。
// ============================================================

header('Content-Type: application/json; charset=utf-8');
@set_time_limit(180); // web検索に時間がかかるため延長（サーバー側の上限に依存）

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'POSTで呼び出してください。'], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- 設定（APIキー・モデル） ---
$cfg = [];
if (is_file(__DIR__ . '/config.php')) {
    $c = include __DIR__ . '/config.php';
    if (is_array($c)) $cfg = $c;
}
$apiKey = getenv('ANTHROPIC_API_KEY') ?: ($cfg['api_key'] ?? '');
$model  = getenv('AI_MODEL') ?: ($cfg['model'] ?? 'claude-sonnet-5'); // 共用サーバーの時間制限を考え既定はsonnet
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'サーバー側でAPIキーが設定されていません（config.php を作成してください）。'], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- 入力 ---
$body  = json_decode(file_get_contents('php://input'), true);
$query = trim($body['query'] ?? '');
if ($query === '') {
    http_response_code(400);
    echo json_encode(['error' => 'URLまたは会社名を入力してください。'], JSON_UNESCAPED_UNICODE);
    exit;
}

$taxonomy = @file_get_contents(__DIR__ . '/taxonomy.txt');
if ($taxonomy === false) $taxonomy = '';

// --- プロンプト ---
$SYSTEM = <<<'EOT'
あなたは、日本の外国人材受入れ制度（技能実習・特定技能）の営業を支援するリサーチアシスタントです。
利用者が入力した企業のURLまたは会社名について、ウェブ検索・ページ取得ツールを使って事業内容を調べ、
「その企業が受入れを検討できそうな制度・分野・作業の候補」を根拠とともに提示します。

# 調べ方
- 入力がURLならそのページを web_fetch で読む。会社名なら web_search で公式サイト等を探し、必要に応じて web_fetch で読む。
- 事業内容・主要製品・工程・拠点・募集職種などが分かる情報を優先。過度な検索はしない（検索は合計3回程度まで）。

# 絶対に守るルール
1. 候補は必ず後述の「対象職種・作業リスト」に載っている field / job / tasks の中からのみ選ぶ。リストに無い職種・分野を新しく作らない。
2. 調べても分かるのは「業種の当たり」までである。在留資格の可否は、実際に外国人が従事する具体的作業・必須業務の比率・受入れ体制で決まる。よって「確率○%」のような断定はせず、証拠の強さを "強"/"中"/"弱" の3段階で示す。
   - 強：調べた情報にその作業・製品・工程が明確に記述されている
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
    { "system": "特定技能", "candidates": [ ] }
  ],
  "questions": ["受入れ可否を詰めるために企業へ確認すべき質問（3〜6個）"],
  "caveats": ["この診断の限界・注意点（必ず『調べて分かるのは業種の当たりまで。可否は個別確認が必要』を含める）"]
}
候補は各制度とも証拠の強い順に最大6件。該当が無い制度は candidates を空配列にする。
EOT;

$userPrompt = "# 対象職種・作業リスト（この中からのみ候補を選ぶ）\n" . $taxonomy .
    "\n\n# 調べる対象\n" . $query .
    "\n\n上記の企業についてツールで調べ、指定JSON形式で候補を出力してください。";

// --- Anthropic API 呼び出し ---
class BadRequest extends Exception {}

function callClaude($apiKey, $model, $system, $messages, $tools)
{
    $payload = [
        'model'      => $model,
        'max_tokens' => 8000,
        'thinking'   => ['type' => 'adaptive'],
        'system'     => $system,
        'messages'   => $messages,
    ];
    if (!empty($tools)) $payload['tools'] = $tools;

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 170,
        CURLOPT_HTTPHEADER     => [
            'content-type: application/json',
            'x-api-key: ' . $apiKey,
            'anthropic-version: 2023-06-01',
        ],
        CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    $res    = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);
    if ($res === false) throw new Exception('通信エラー: ' . $err);
    return [$status, $res];
}

function runOnce($apiKey, $model, $system, $userPrompt, $tools)
{
    $messages = [['role' => 'user', 'content' => $userPrompt]];
    for ($step = 0; $step < 8; $step++) {
        list($status, $res) = callClaude($apiKey, $model, $system, $messages, $tools);
        if ($status === 400) throw new BadRequest($res);         // ツール非対応等 → フォールバック
        if ($status !== 200) throw new Exception('AI応答エラー(' . $status . '): ' . mb_substr($res, 0, 300));
        $data = json_decode($res, true);
        if (($data['stop_reason'] ?? '') === 'pause_turn') {       // web検索の途中経過 → 継続
            $messages[] = ['role' => 'assistant', 'content' => $data['content']];
            continue;
        }
        $text = '';
        foreach (array_reverse($data['content'] ?? []) as $b) {
            if (($b['type'] ?? '') === 'text') { $text = $b['text']; break; }
        }
        return $text;
    }
    throw new Exception('AIの処理が長すぎて完了しませんでした。');
}

// モデル/SDKのツール対応差に強くするため段階的に試す
$toolSets = [
    [
        ['type' => 'web_search_20260209', 'name' => 'web_search', 'max_uses' => 3],
        ['type' => 'web_fetch_20260209',  'name' => 'web_fetch',  'max_uses' => 2],
    ],
    [['type' => 'web_search_20260209', 'name' => 'web_search', 'max_uses' => 3]],
    [['type' => 'web_search_20250305', 'name' => 'web_search', 'max_uses' => 3]],
    [], // 最後の保険：ツールなし（モデルの知識のみ）
];

$text = null;
$lastErr = null;
foreach ($toolSets as $tools) {
    try {
        $text = runOnce($apiKey, $model, $SYSTEM, $userPrompt, $tools);
        break;
    } catch (BadRequest $e) {
        $lastErr = $e;
        continue; // ツール非対応 → 次の組み合わせ
    } catch (Exception $e) {
        $lastErr = $e;
        break;
    }
}

if ($text === null) {
    http_response_code(500);
    echo json_encode(['error' => '診断に失敗しました：' . ($lastErr ? $lastErr->getMessage() : '不明なエラー')], JSON_UNESCAPED_UNICODE);
    exit;
}

// --- 応答をJSONとして取り出す（防御的） ---
$obj = json_decode($text, true);
if (!is_array($obj)) {
    if (preg_match('/\{[\s\S]*\}/', $text, $m)) $obj = json_decode($m[0], true);
}
if (!is_array($obj)) {
    http_response_code(502);
    echo json_encode(['error' => 'AIの応答を解析できませんでした。もう一度お試しください。'], JSON_UNESCAPED_UNICODE);
    exit;
}

// 整形
$obj['summary']   = $obj['summary']   ?? '';
$obj['sources']   = isset($obj['sources'])   && is_array($obj['sources'])   ? $obj['sources']   : [];
$obj['systems']   = isset($obj['systems'])   && is_array($obj['systems'])   ? $obj['systems']   : [];
$obj['questions'] = isset($obj['questions']) && is_array($obj['questions']) ? $obj['questions'] : [];
$obj['caveats']   = isset($obj['caveats'])   && is_array($obj['caveats'])   ? $obj['caveats']   : [];
foreach ($obj['systems'] as &$s) {
    $s['candidates'] = isset($s['candidates']) && is_array($s['candidates']) ? $s['candidates'] : [];
    foreach ($s['candidates'] as &$c) {
        $c['tasks'] = isset($c['tasks']) && is_array($c['tasks']) ? $c['tasks'] : [];
    }
    unset($c);
}
unset($s);

echo json_encode($obj, JSON_UNESCAPED_UNICODE);
