/**
 * The Apple Watch companion app: a live preview of what the phone is recording, and score controls.
 * Added to the generated Xcode project by the @bacons/apple-targets plugin on every `expo prebuild`; the Swift files in this folder are
 * the app. See the README ("Apple Watch").
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: 'watch',
  name: 'RallyCamWatch',
  displayName: 'RallyCam',
  // Apple Watch Series 9 runs the latest watchOS; 10 is the oldest this app asks for
  deploymentTarget: '10.0',
  // com.darrenliau.rallycam.watchkitapp
  bundleIdentifier: '.watchkitapp',
  icon: '../../assets/icon.png',
};
