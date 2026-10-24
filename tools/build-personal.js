#!/usr/bin/env node
/* Local personal build. Not published. Cloud sync stays blocked because the
   storage key is not the demo key and allowPersonalData is false. */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var dest = path.join(root, 'build', 'personal');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace("var KEY='duoBudget.demo.v1';/*@@KEY@@*/", "var KEY='duoBudget.v1';/*@@KEY@@*/");
html = html.replace('var PERSONAL_BUILD=false;/*@@PERSONAL@@*/', 'var PERSONAL_BUILD=true;/*@@PERSONAL@@*/');
var a = html.indexOf('/*@@TRENDS_SYNTH_START@@*/');
var b = html.indexOf('/*@@TRENDS_SYNTH_END@@*/');
if (a < 0 || b < 0) throw new Error('TRENDS_SYNTH markers missing');
html = html.slice(0, a + '/*@@TRENDS_SYNTH_START@@*/'.length) + '\nvar TRENDS_SYNTH=null;\n' + html.slice(b);
fs.writeFileSync(path.join(dest, 'index.html'), html);
fs.cpSync(path.join(root, 'icons'), path.join(dest, 'icons'), { recursive: true });
['supabase.js', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  fs.copyFileSync(path.join(root, f), path.join(dest, f));
});
console.log('built ' + dest);
