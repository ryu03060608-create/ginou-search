// src/data.js の公式リストを、PHPバックエンドが読む taxonomy.txt に書き出す。
// npm run build:sakura から呼ばれる。data.js を更新したら再実行すること。
import fs from 'fs'
import { GINOU_JISSHU, TOKUTEI_GINOU } from '../src/data.js'

const block = (title, data) =>
  `【${title}】\n` +
  data.map((g) => g.jobs.map((j) => `- ${g.field} ＞ ${j.job}：${j.tasks.join(' / ')}`).join('\n')).join('\n')

const txt = [
  block('技能実習の対象職種・作業（移行対象）', GINOU_JISSHU),
  block('特定技能の分野・業務区分', TOKUTEI_GINOU),
].join('\n\n')

fs.writeFileSync('sakura-api/taxonomy.txt', txt)
console.log('wrote sakura-api/taxonomy.txt (' + txt.length + ' chars)')
