package com.nitroforge.ignitionv1;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;
import java.util.Collections;
import java.util.List;

public final class NitroForgePackage implements ReactPackage {
  static { System.loadLibrary("NitroForgeV1"); }
  @Override public List<NativeModule> createNativeModules(ReactApplicationContext context) {
    return Collections.emptyList();
  }
  @Override public List<ViewManager> createViewManagers(ReactApplicationContext context) {
    return Collections.emptyList();
  }
}
