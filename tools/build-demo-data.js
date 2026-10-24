#!/usr/bin/env node
/* Local Chloe & Jack build with preview spending. Not copied to /demo/.
   The live deploy sync flag is turned off in this copy so a screenshot
   pass does not call the hosted project. */
'use strict';
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var dest = path.join(root, 'build', 'demo-data');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('"enabled":true', '"enabled":false');
var seed = '<script>window.__DUO_PREVIEW_SEED__=true;</script>';
var at = html.indexOf('<script id="duo-sync-lib">');
if (at < 0) throw new Error('sync script tag missing');
html = html.slice(0, at) + seed + '\n' + html.slice(at);
if (html.indexOf('Chloe') < 0 || html.indexOf('Jack') < 0) throw new Error('demo household missing');
fs.writeFileSync(path.join(dest, 'index.html'), html);
fs.cpSync(path.join(root, 'icons'), path.join(dest, 'icons'), { recursive: true });
['supabase.js', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  fs.copyFileSync(path.join(root, f), path.join(dest, f));
});
console.log('built ' + dest);
