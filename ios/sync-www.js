/* Copies the web app into build/capacitor for `npx cap sync`.
   Does not touch the GitHub Pages site, the personal/demo builds, or the waitlist.
   build/ is gitignored; Capacitor copies this folder into the native projects at sync time. */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var dest = path.join(root, 'build', 'capacitor');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
['index.html', 'supabase.js', 'manifest.webmanifest', 'sw.js', 'duo-account.js', 'duo-lock.js', 'duo-gate.js', 'duo-premium.js', 'duo-premium-ui.js'].forEach(function (name) {
  fs.copyFileSync(path.join(root, name), path.join(dest, name));
});
fs.cpSync(path.join(root, 'icons'), path.join(dest, 'icons'), { recursive: true });
console.log('Copied web app to build/capacitor');
