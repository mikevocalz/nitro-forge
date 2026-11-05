package com.margelo.nitro.nitroforge.ignitionv1

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers generated Nitro v1 factory and JNI; no legacy native module stub. */
class NitroForgeV1Package : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? = null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider =
    ReactModuleInfoProvider { HashMap() }

  companion object {
    init {
      NitroForgeV1OnLoad.initializeNative()
    }
  }
}
