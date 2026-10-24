#!/usr/bin/env node
/* New spending copy must stay in the planning voice: no exclamation marks,
   no "Over budget", no "transaction", no emoji. */
'use strict';
var fs = require('fs');
var path = require('path');
var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function between(a, b) {
  var i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0 || j < i) throw new Error('missing region ' + a);
  return html.slice(i, j);
}

var regions = [
  between('<!-- SPENDING -->', '<!-- TRENDS -->'),
  between('id="spentCard"', 'id="addSpend"') + '>+ Add spending</button>',
  between('/*@@BUCKET_START@@*/', '/*@@TRENDS_SYNTH_START@@*/'),
  between('/*@@TRENDS_SYNTH_END@@*/', 'function trWins()'),
  between("M.src==='recorded'", 'M.src?')
];
var htmlBits = regions.slice(0, 2).map(function (chunk) {
  return chunk.replace(/<[^>]*>/g, ' ');
});
var jsBits = regions.slice(2).join('\n');
var strings = htmlBits.slice();
var re = /'([^'\\]|\\.)*'|"([^"\\]|\\.)*"|`([^`\\]|\\.)*`/g;
var m;
while ((m = re.exec(jsBits))) strings.push(m[0].slice(1, -1));
var blob = strings.join('\n');

var banned = [
  { name: 'exclamation mark', re: /!/ },
  { name: 'Over budget', re: /over budget/i },
  { name: 'transaction', re: /transaction/i },
  { name: 'emoji', re: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u }
];
var fails = [];
strings.forEach(function (s) {
  banned.forEach(function (b) {
    if (b.re.test(s)) fails.push(b.name + ' in: ' + s.slice(0, 180));
  });
});
if (!/from the spending you\\?'ve recorded/.test(blob)) fails.push('Trends subtitle is missing');
if (!/Add spending/.test(blob)) fails.push('Add spending label is missing');
if (!/Running over by/.test(blob)) fails.push('Running over wording is missing');
if (fails.length) {
  console.error(fails.join('\n'));
  process.exit(1);
}
console.log('copy lint ok (' + strings.length + ' strings)');
