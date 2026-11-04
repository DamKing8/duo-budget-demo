#!/usr/bin/env node
/* Checks the Capacitor iOS project is ready to open in Xcode and sign with a
   free Apple ID (Personal Team). Does not need a Mac. Run after `cap sync ios`. */
'use strict';
var fs = require('fs');
var path = require('path');

var root = path.join(__dirname, '..');
var ios = path.join(root, 'capacitor-ios');
var problems = [];

function need(cond, msg) {
  if (!cond) problems.push(msg);
}

function read(rel) {
  var file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    problems.push('missing ' + rel);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function plistString(xml, key) {
  var re = new RegExp('<key>' + key + '</key>\\s*<string>([^<]*)</string>');
  var match = xml.match(re);
  return match ? match[1] : null;
}

function walk(dir, hit) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (ent) {
    var full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, hit);
    else hit(full);
  });
}

var plist = read('capacitor-ios/App/App/Info.plist');
need(plist.indexOf('<?xml') === 0 && plist.indexOf('<plist') !== -1 && plist.indexOf('</plist>') !== -1, 'Info.plist is not a plist');
need(plistString(plist, 'CFBundleDisplayName') === 'Duo Budget', 'CFBundleDisplayName must be Duo Budget');
need(plistString(plist, 'CFBundleShortVersionString') === '$(MARKETING_VERSION)', 'short version must come from MARKETING_VERSION');
need(plistString(plist, 'CFBundleVersion') === '$(CURRENT_PROJECT_VERSION)', 'build number must come from CURRENT_PROJECT_VERSION');
need(plistString(plist, 'CFBundleIdentifier') === '$(PRODUCT_BUNDLE_IDENTIFIER)', 'bundle id must come from PRODUCT_BUNDLE_IDENTIFIER');
need(/<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>au\.duobudget\.app<\/string>\s*<\/array>/.test(plist), 'Info.plist must register the URL scheme au.duobudget.app');
need(plistString(plist, 'NSMicrophoneUsageDescription') === 'Duo Budget uses the microphone so you can add an expense by saying it out loud.', 'Info.plist must include NSMicrophoneUsageDescription for spoken expenses');
need(plistString(plist, 'NSSpeechRecognitionUsageDescription') === 'Duo Budget uses speech recognition to turn what you say into an expense entry.', 'Info.plist must include NSSpeechRecognitionUsageDescription for spoken expenses');
need(!/UIBackgroundModes|aps-environment|com\.apple\.developer|NFCReaderUsageDescription/.test(plist), 'Info.plist must not request push or other paid capabilities');

var project = read('capacitor-ios/App/App.xcodeproj/project.pbxproj');
var blocks = [];
var re = /buildSettings = \{([\s\S]*?)\n\t\t\t\};/g;
var match;
while ((match = re.exec(project))) blocks.push(match[1]);
need(blocks.length >= 4, 'expected Debug and Release settings for the project and the App target');

var appTargets = blocks.filter(function (block) { return /PRODUCT_BUNDLE_IDENTIFIER/.test(block); });
need(appTargets.length === 2, 'App target needs Debug and Release configurations');
appTargets.forEach(function (block) {
  need(/PRODUCT_BUNDLE_IDENTIFIER = au\.duobudget\.app;/.test(block), 'bundle id must be au.duobudget.app');
  need(/MARKETING_VERSION = 0\.1\.0;/.test(block), 'version must be 0.1.0');
  need(/CURRENT_PROJECT_VERSION = 1;/.test(block), 'build number must be 1');
  need(/IPHONEOS_DEPLOYMENT_TARGET = 15\.0;/.test(block), 'App target deployment target must be iOS 15.0');
  need(/CODE_SIGN_STYLE = Automatic;/.test(block), 'signing must be automatic');
  need(/DEVELOPMENT_TEAM = "";/.test(block), 'DEVELOPMENT_TEAM must be empty so a Personal Team can be chosen on the Mac');
});
blocks.forEach(function (block) {
  need(!/IPHONEOS_DEPLOYMENT_TARGET = (?!15\.0;)/.test(block), 'every deployment target must be iOS 15.0');
  need(!/DEVELOPMENT_TEAM = (?!"")/.test(block), 'a team id must not be committed');
});
need(/ProvisioningStyle = Automatic;/.test(project), 'Xcode provisioning style must be automatic');
need(!/CODE_SIGN_ENTITLEMENTS|PROVISIONING_PROFILE|SystemCapabilities/.test(project), 'the App target must not reference entitlements or manual profiles');

var banned = [
  'com.apple.Push',
  'aps-environment',
  'com.apple.developer.applesignin',
  'com.apple.security.application-groups',
  'com.apple.developer.associated-domains',
  'com.apple.developer.icloud-services',
  'com.apple.developer.icloud-container-identifiers',
  'com.apple.developer.networking.networkextension',
  'com.apple.developer.healthkit',
  'com.apple.developer.in-app-payments',
  'com.apple.developer.siri'
];
var tree = '';
walk(ios, function (file) {
  if (file.endsWith('.entitlements')) problems.push('remove entitlements file ' + path.relative(root, file));
  if (path.basename(file) === 'Podfile' || path.basename(file) === 'Podfile.lock') problems.push('CocoaPods file is not used: ' + path.relative(root, file));
  if (/\.(plist|pbxproj|entitlements|swift|xcconfig)$/.test(file)) tree += fs.readFileSync(file, 'utf8') + '\n';
});
banned.forEach(function (needle) {
  need(tree.indexOf(needle) === -1, 'paid-only capability must stay out of capacitor-ios: ' + needle);
});

var pkg = read('capacitor-ios/App/CapApp-SPM/Package.swift');
need(/\.iOS\(\.v15\)/.test(pkg), 'CapApp-SPM must require iOS 15');
need(/capacitor-swift-pm/.test(pkg), 'CapApp-SPM must use Swift Package Manager');
need(/CapacitorApp/.test(pkg) && /CapacitorBrowser/.test(pkg), 'SPM must link @capacitor/app and @capacitor/browser');
need(!/Podfile/.test(pkg), 'Package.swift must not point at CocoaPods');

var configRaw = read('capacitor-ios/App/App/capacitor.config.json');
if (configRaw) {
  var config;
  try { config = JSON.parse(configRaw); } catch (e) { config = null; problems.push('capacitor.config.json in the iOS app is not JSON'); }
  if (config) {
    need(config.appId === 'au.duobudget.app', 'synced capacitor.config.json appId must be au.duobudget.app');
    need(config.appName === 'Duo Budget', 'synced capacitor.config.json appName must be Duo Budget');
  }
}

var publicIndex = read('capacitor-ios/App/App/public/index.html');
need(publicIndex.indexOf('au.duobudget.app://auth-callback') !== -1, 'synced web assets must include the auth return link');
need(publicIndex.indexOf('appUrlOpen') !== -1, 'synced web assets must listen for appUrlOpen');
need(publicIndex.indexOf('exchangeCodeForSession') !== -1, 'synced web assets must exchange the PKCE code');
need(fs.existsSync(path.join(ios, 'App/App/public/supabase.js')), 'synced web assets must include supabase.js');
need(fs.existsSync(path.join(ios, 'App/App/public/icons')), 'synced web assets must include icons');

var scene = read('capacitor-ios/App/App/SceneDelegate.swift');
need(scene.indexOf('name: "duoSpeech"') !== -1, 'the iOS shell must register the duoSpeech handler before the page loads');
need(scene.indexOf('requestAuthorization') !== -1, 'voice entry must ask for speech recognition permission');
need(scene.indexOf('requestRecordPermission') !== -1, 'voice entry must ask for microphone permission');

var syncJs = read('backend/client/duo-sync.js');
need(syncJs.indexOf("var NATIVE_AUTH_REDIRECT='au.duobudget.app://auth-callback'") !== -1, 'native redirect must be au.duobudget.app://auth-callback');
need(syncJs.indexOf("addListener('appUrlOpen'") !== -1, 'sign-in must listen for appUrlOpen');
need(syncJs.indexOf('closeNativeBrowser();') !== -1, 'the return link must close the in-app browser');
need(syncJs.indexOf('exchangeCodeForSession') !== -1, 'the return link must call exchangeCodeForSession');
need(!/\.getPlatform\(/.test(syncJs), 'the sign-in path must be the same on iOS and Android');
need(/isNativePlatform/.test(syncJs), 'native sign-in must use Capacitor.isNativePlatform');

var widget = read('ios/DuoBudget.xcodeproj/project.pbxproj');
need(widget.indexOf('au.com.duobudget.app') !== -1, 'widget project bundle id should stay au.com.duobudget.app');

if (problems.length) {
  console.error('iOS project is not ready:');
  problems.forEach(function (msg) { console.error(' - ' + msg); });
  process.exit(1);
}
console.log('iOS project is ready to open: au.duobudget.app, Duo Budget, 0.1.0 (1), iOS 15, automatic signing, no team, URL scheme au.duobudget.app, web assets copied.');
