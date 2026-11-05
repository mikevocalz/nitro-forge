# Used only if the app goes back to CocoaPods. Under experiments.swiftPackageManager
# Expo's SwiftPM plugin builds these sources without reading this file; the iOS 27.1
# SDK gate therefore lives in Swift (`canImport(UIKit, _version:)`), not here.
require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ReservedRegions'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'Nitro-Forge'
  s.homepage       = 'https://github.com/mikevocalz/nitro-forge'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '6.0'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
end
