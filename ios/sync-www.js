/* Copies the web app into build/capacitor for `npx cap sync`.
   Does not touch the GitHub Pages site, the personal/demo builds, or the waitlist.
   build/ is gitignored; Capacitor copies this folder into the native projects at sync time.
   Also writes the build stamp the phone shows, so a stale shell is obvious. */
var fs = require('fs');
var path = require('path');
var exec = require('child_process').execSync;
var root = path.join(__dirname, '..');
var dest = path.join(root, 'build', 'capacitor');

function git(cmd) {
  try { return exec(cmd, { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { return ''; }
}

var sha = git('git rev-parse --short HEAD') || 'unknown';
var time = new Date().toISOString();
var stamp = { sha: sha, time: time };

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
['index.html', 'supabase.js', 'manifest.webmanifest', 'sw.js', 'duo-account.js', 'duo-lock.js', 'duo-gate.js', 'duo-premium.js', 'duo-premium-ui.js'].forEach(function (name) {
  fs.copyFileSync(path.join(root, name), path.join(dest, name));
});
fs.cpSync(path.join(root, 'icons'), path.join(dest, 'icons'), { recursive: true });

var info = 'window.DUO_BUILD=' + JSON.stringify(stamp) + ';\n';
fs.writeFileSync(path.join(dest, 'build-info.js'), info);
var indexPath = path.join(dest, 'index.html');
var html = fs.readFileSync(indexPath, 'utf8');
html = html.replace('window.DUO_BUILD=window.DUO_BUILD||{sha:"dev",time:""};', 'window.DUO_BUILD=' + JSON.stringify(stamp) + ';');
fs.writeFileSync(indexPath, html);
if (html.indexOf('Currency converter') !== -1) {
  console.error('\n*** BUILD FAILED: build/capacitor/index.html still contains "Currency converter". This is a stale page. ***\n');
  process.exit(1);
}
console.log('Copied web app to build/capacitor');
console.log('Build stamp ' + sha + ' ' + time);
