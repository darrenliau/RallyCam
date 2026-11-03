// Newer Xcode only accepts iOS deployment targets from 15.0. A few third-party pods still ask for 12.0 or so, which stops the build with
// "The iOS deployment target 'IPHONEOS_DEPLOYMENT_TARGET' is set to 12.0, but the range of supported deployment target versions is 15.0 to ...".
// This adds a step to the Podfile that raises any pod below 15.0 to 15.0. It runs every time `expo prebuild` writes the Podfile.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARK = '# rallycam: raise old pod deployment targets';
const STEP = `
  ${MARK}
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
      if current && current.to_f < 15.0
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
      end
    end
  end
`;

module.exports = function withPodsDeploymentTarget(config) {
  return withDangerousMod(config, ['ios', (cfg) => {
    const file = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
    if (!fs.existsSync(file)) return cfg;
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(MARK)) return cfg;
    const pattern = /post_install do \|installer\|\n/;
    if (!pattern.test(text)) return cfg;
    fs.writeFileSync(file, text.replace(pattern, (m) => m + STEP));
    return cfg;
  }]);
};
