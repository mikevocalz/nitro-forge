// Compile-check stand-in for React Native codegen output.
package com.margelo.nitro

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.turbomodule.core.interfaces.TurboModule

abstract class NativeNitroModulesSpec(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), TurboModule
