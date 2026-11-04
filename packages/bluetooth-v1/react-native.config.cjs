/**
 * Android-only Nitro v1 BLE central. There is no Apple implementation, so iOS
 * autolinking is disabled; Android autolinks ForgeBluetoothPackage.
 */
module.exports = {
  dependency: {
    platforms: {
      android: {
        packageImportPath: "import com.margelo.nitro.forgebluetooth.ForgeBluetoothPackage;",
        packageInstance: "new ForgeBluetoothPackage()",
      },
      ios: null,
    },
  },
};
