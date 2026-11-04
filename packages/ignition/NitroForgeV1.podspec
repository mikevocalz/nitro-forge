require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))
# Discovery only. Nitro v1 / RN 0.88 build the sources with SwiftPM.
Pod::Spec.new do |s|
  s.name = "NitroForgeV1"
  s.version = package["version"]
  s.summary = package["description"]
  s.homepage = "https://github.com/mikevocalz/nitro-forge"
  s.license = "MIT"
  s.author = "Nitro Forge"
  s.source = { :git => "https://github.com/mikevocalz/nitro-forge.git" }
  s.ios.deployment_target = "16.0"
end
