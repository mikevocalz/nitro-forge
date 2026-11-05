require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
Pod::Spec.new do |s|
  s.name = "NitroForgeV1"
  s.version = package["version"]
  s.summary = package["description"]
  s.homepage = "https://github.com/mikevocalz/nitro-forge"
  s.license = { :type => "MIT" }
  s.author = { "Nitro Forge" => "maintainers" }
  s.source = { :git => "https://github.com/mikevocalz/nitro-forge.git" }
  s.ios.deployment_target = "16.0"
  # React Native discovery only. Nitro v1 C++ + Rust are linked with SwiftPM.
end
