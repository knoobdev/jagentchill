Pod::Spec.new do |s|
  s.name = 'JAgentChillTailscale'
  s.version = '0.1.0'
  s.summary = 'Embedded Tailscale transport for JAgentChill'
  s.license = 'BSD-3-Clause'
  s.author = 'JAgentChill'
  s.homepage = 'https://jagentchill.local'
  s.platforms = { :ios => '13.4' }
  s.swift_version = '5.4'
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.vendored_frameworks = 'JAgentChillTailscaleBridge.xcframework'
  # Keep generated Go framework headers out of CocoaPods' umbrella header.
  # The xcframework already exports those headers through its own module map.
  s.source_files = '*.swift'
end
