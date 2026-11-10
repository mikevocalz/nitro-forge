// Qt hosts install Nitro before evaluating the bundle. Import the shared core
// directly; the Apple/Android React Native installer is not part of this path.
const { NitroModules } = require('nitro-core');
let hybridClass;
module.exports = {
  get ForgeFactory() {
    if (hybridClass === undefined) {
      hybridClass = NitroModules.getHybridClass('nitroforge.ignitionv1.ForgeFactory');
    }
    return hybridClass;
  },
};
