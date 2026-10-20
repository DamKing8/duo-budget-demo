/* Copies the web app into www/ for `npx cap sync`. Does not touch main or the waitlist. */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var dest = path.join(root, 'www');
fs.mkdirSync(dest, { recursive: true });
['index.html', 'supabase.js', 'manifest.webmanifest', 'sw.js'].forEach(function (name) {
  fs.copyFileSync(path.join(root, name), path.join(dest, name));
});
fs.cpSync(path.join(root, 'icons'), path.join(dest, 'icons'), { recursive: true });
console.log('Copied web app to www/');
