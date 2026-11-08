import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Xcode Cloud looks for ci_scripts next to the workspace, in ios/. Expo's prebuild deletes that folder when it makes ios/, so it is easy
// to commit its removal by accident. Without it the cloud build stops with "Workspace RallyCam.xcworkspace does not exist".
describe('Xcode Cloud setup scripts', () => {
  it('ios/ci_scripts/ci_post_clone.sh exists, is executable and runs the main script', () => {
    const hook = 'ios/ci_scripts/ci_post_clone.sh';
    expect(existsSync(hook), `${hook} is missing: restore it with git checkout a74539a -- ${hook}`).toBe(true);
    expect(statSync(hook).mode & 0o111).not.toBe(0);
    expect(readFileSync(hook, 'utf8')).toContain('ci_scripts/ci_post_clone.sh');
  });
  it('the main script exists and is executable', () => {
    expect(existsSync('ci_scripts/ci_post_clone.sh')).toBe(true);
    expect(statSync('ci_scripts/ci_post_clone.sh').mode & 0o111).not.toBe(0);
  });
  it('the shuttle model is in the repository', () => {
    expect(existsSync('modules/rallycam-export/ios/Models/TrackNetV3.mlpackage/Manifest.json')).toBe(true);
  });
  it('the Apple Watch app is in the repository and the plugin that adds it to the project is set up', () => {
    expect(existsSync('targets/watch/expo-target.config.js')).toBe(true);
    expect(existsSync('targets/watch/RallyCamWatchApp.swift')).toBe(true);
    const plugins = JSON.parse(readFileSync('app.json', 'utf8')).expo.plugins as unknown[];
    expect(plugins).toContain('@bacons/apple-targets');
  });
  it('the watch app says it is a watch app (WKApplication) and names its companion, which the App Store export checks', () => {
    const plist = readFileSync('targets/watch/Info.plist', 'utf8');
    expect(plist).toMatch(/<key>WKApplication<\/key>\s*<true\/>/);
    expect(plist).toContain('<key>WKCompanionAppBundleIdentifier</key>');
    expect(plist).toContain('com.darrenliau.rallycam');
  });
  it('the setup script gives the phone app and the watch app the same build number', () => {
    expect(readFileSync('ci_scripts/ci_post_clone.sh', 'utf8')).toContain('CURRENT_PROJECT_VERSION = $CI_BUILD_NUMBER;');
  });
});
