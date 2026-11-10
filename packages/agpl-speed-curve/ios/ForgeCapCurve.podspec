require 'json'
package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ForgeCapCurve'
  s.version        = '0.0.0'
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = { :type => 'AGPL-3.0-or-later', :file => '../LICENSE' }
  s.author         = 'ArtCraft Team, CapCraft contributors, Nitro Forge contributors'
  s.homepage       = 'https://github.com/mikevocalz/nitro-forge'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/mikevocalz/nitro-forge.git' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
