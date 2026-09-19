<?php
// このファイルを config.php にコピーし、APIキーを入れてください。
//   例: cp config.sample.php config.php
// config.php は .htaccess で外部からの直アクセスを禁止しています。
return [
    // Anthropic のAPIキー（console.anthropic.com で発行）
    'api_key' => 'sk-ant-xxxxxxxx',

    // 使うモデル。
    //   claude-sonnet-5 … 速い・安い（共用サーバー向けの既定・推奨）
    //   claude-opus-5   … 高精度だが遅い・高い（実行時間制限に注意）
    'model'   => 'claude-sonnet-5',
];
