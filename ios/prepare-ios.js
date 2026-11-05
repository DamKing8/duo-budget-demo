/* ios:prepare checks. Warns when this tree is not the iPhone preview tip,
   then copies the web app and refuses a stale page that still has the converter. */
var exec = require('child_process').execSync;
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

function git(cmd) {
  try { return exec(cmd, { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { return ''; }
}

var sha = git('git rev-parse --short HEAD') || 'unknown';
var full = git('git rev-parse HEAD');
var origin = git('git rev-parse --short origin/cursor/ios-test-47-48');
var dirty = git('git status --porcelain');
console.log('ios:prepare building commit ' + sha + ' (' + full + ')');
if (dirty) {
  console.warn('\n*** WARNING: working tree is dirty. The phone will not match commit ' + sha + '. ***');
  console.warn(dirty + '\n');
}
if (!origin) {
  console.warn('\n*** WARNING: origin/cursor/ios-test-47-48 is not available, so this build cannot be checked against the iPhone preview tip. ***\n');
} else if (sha !== origin) {
  console.warn('\n*** WARNING: HEAD ' + sha + ' is not origin/cursor/ios-test-47-48 (' + origin + '). Fetch and checkout that tip before installing on the phone. ***\n');
}

exec('node ios/sync-www.js', { cwd: root, stdio: 'inherit' });
var built = fs.readFileSync(path.join(root, 'build', 'capacitor', 'index.html'), 'utf8');
if (built.indexOf('Currency converter') !== -1) {
  console.error('\n*** ios:prepare FAILED: build/capacitor/index.html still contains "Currency converter". Do not install this build. ***\n');
  process.exit(1);
}
var info = fs.readFileSync(path.join(root, 'build', 'capacitor', 'build-info.js'), 'utf8');
if (info.indexOf(sha) === -1) {
  console.error('\n*** ios:prepare FAILED: build-info.js does not contain commit ' + sha + '. ***\n');
  process.exit(1);
}
console.log('ios:prepare web assets are commit ' + sha + ' and do not contain the currency converter.');
