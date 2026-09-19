// dist/ のビルド結果を1枚の自己完結HTML（ginou-search.html）にインライン化する。
// 使い方: npm run build:single   （内部で vite build → このスクリプト）
// できたファイルはサーバー不要でダブルクリックで開ける。
// ※ AI診断のAPI呼び出しは file:// だとCORSでブロックされる場合があるため、
//   実際にAIを動かす場合は npm run preview か GitHub Pages のURLで開くこと。
import fs from 'fs'
import path from 'path'

const dist = 'dist'
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')

// <link rel="stylesheet" href="./assets/xxx.css"> を <style> でインライン
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/g, (_m, href) => {
  const p = path.join(dist, href.replace(/^\.?\//, ''))
  return `<style>\n${fs.readFileSync(p, 'utf8')}\n</style>`
})

// <script type="module" src="./assets/xxx.js"></script> を中身でインライン
html = html.replace(/<script[^>]*src="([^"]+\.js)"[^>]*><\/script>/g, (_m, src) => {
  const p = path.join(dist, src.replace(/^\.?\//, ''))
  return `<script type="module">\n${fs.readFileSync(p, 'utf8')}\n</script>`
})

// 単体ファイルでは不要な外部参照（manifest/icon）を除去し file:// の404を避ける
html = html.replace(/<link[^>]*rel="manifest"[^>]*>\s*/g, '')
html = html.replace(/<link[^>]*rel="(apple-touch-icon|icon)"[^>]*>\s*/g, '')

fs.writeFileSync('ginou-search.html', html)
console.log('wrote ginou-search.html:', (fs.statSync('ginou-search.html').size / 1024).toFixed(0) + 'KB')
