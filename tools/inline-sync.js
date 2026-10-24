#!/usr/bin/env node
/* Replace the inlined DuoSync block in index.html from backend/client/duo-sync.js.
   --check exits 1 when index.html has drifted from the source file. */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var src = fs.readFileSync(path.join(root, 'backend/client/duo-sync.js'), 'utf8').replace(/\s+$/, '');
var htmlPath = path.join(root, 'index.html');
var html = fs.readFileSync(htmlPath, 'utf8');
var start = '/*@@SYNC_START@@*/';
var end = '/*@@SYNC_END@@*/';
var a = html.indexOf(start);
var b = html.indexOf(end);
if (a < 0 || b < 0 || b < a) {
  console.error('index.html is missing @@SYNC markers');
  process.exit(1);
}
var next = html.slice(0, a + start.length) + '\n' + src + '\n' + html.slice(b);
if (process.argv.indexOf('--check') >= 0) {
  if (next !== html) {
    console.error('index.html sync block does not match backend/client/duo-sync.js. Run: node tools/inline-sync.js');
    process.exit(1);
  }
  console.log('sync inline matches duo-sync.js');
  process.exit(0);
}
fs.writeFileSync(htmlPath, next);
console.log('inlined backend/client/duo-sync.js into index.html');
