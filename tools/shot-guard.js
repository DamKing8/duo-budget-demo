#!/usr/bin/env node
/* Refuse screenshots of the repo index.html. Preview shots come from a local
   demo-data build (Chloe and Jack) and are never taken from the app root. */
'use strict';
var fs = require('fs');
var path = require('path');

function assertDemoHtml(file) {
  var resolved = path.resolve(file);
  var rootIndex = path.resolve(__dirname, '..', 'index.html');
  if (resolved === rootIndex) {
    throw new Error('shot-guard: refusing to screenshot the real index.html');
  }
  var demoRoot = path.resolve(__dirname, '..', 'build', 'demo-data');
  if (resolved !== demoRoot && resolved.indexOf(demoRoot + path.sep) !== 0) {
    throw new Error('shot-guard: screenshots must come from build/demo-data (' + resolved + ')');
  }
  var html = fs.readFileSync(resolved, 'utf8');
  if (html.indexOf('Chloe') < 0 || html.indexOf('Jack') < 0) {
    throw new Error('shot-guard: demo-data build must be the Chloe and Jack household');
  }
  if (html.indexOf('__DUO_PREVIEW_SEED__') < 0) {
    throw new Error('shot-guard: demo-data build is missing the preview seed flag');
  }
  return resolved;
}

module.exports = { assertDemoHtml: assertDemoHtml };

if (require.main === module) {
  var target = process.argv[2] || path.join(__dirname, '..', 'index.html');
  try {
    assertDemoHtml(target);
    console.error('shot-guard should have refused ' + target);
    process.exit(1);
  } catch (e) {
    if (/refusing to screenshot the real index\.html/.test(e.message) || /build\/demo-data/.test(e.message)) {
      console.log('shot-guard ok: ' + e.message);
      process.exit(0);
    }
    throw e;
  }
}
