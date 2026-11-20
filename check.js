'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1]).filter(source => source.trim());

if (!scripts.length) throw new Error('Không tìm thấy mã JavaScript nội tuyến trong public/index.html');
for (let index = 0; index < scripts.length; index++) {
  new vm.Script(scripts[index], { filename: `public/index.html:inline-script-${index + 1}` });
}
new vm.Script(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), { filename: 'server.js' });
JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

console.log(`Kiểm tra cú pháp đạt: ${scripts.length} khối JavaScript trong HTML và server.js.`);
