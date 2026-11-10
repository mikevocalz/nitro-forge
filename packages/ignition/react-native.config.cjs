module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.nitroforge.ignitionv1.NitroForgePackage;',
        packageInstance: 'new NitroForgePackage()',
      },
    },
  },
};
