#!/usr/bin/env node
/* The personal build must not carry the demo's synthetic trend history. */
'use strict';
var fs = require('fs');
var path = require('path');
var file = process.argv[2] || path.join(__dirname, '..', 'build', 'personal', 'index.html');
var html = fs.readFileSync(file, 'utf8');
var fails = [];
if (/DEMO_SYNTHETIC_HISTORY/.test(html)) fails.push('personal build still contains DEMO_SYNTHETIC_HISTORY');
if (/var TRENDS_SYNTH\s*=\s*function/.test(html)) fails.push('personal build still has a TRENDS_SYNTH function');
if (!/var TRENDS_SYNTH=null;/.test(html)) fails.push('personal build does not set TRENDS_SYNTH=null');
if (!/var KEY='duoBudget\.v1';/.test(html)) fails.push('personal build key is not duoBudget.v1');
if (/var KEY='duoBudget\.demo\.v1';/.test(html)) fails.push('personal build still assigns the demo storage key');
if (!/var PERSONAL_BUILD=true;/.test(html)) fails.push('PERSONAL_BUILD is not true');
if (fails.length) {
  console.error(fails.join('\n'));
  process.exit(1);
}
console.log('privacy-check ok ' + file);
