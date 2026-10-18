Pod::Spec.new do |s|
  s.name           = 'FlypVideoFilter'
  s.version        = '1.0.0'
  s.summary        = 'Bakes a colour matrix into a recorded video'
  s.description    = 'Re-encodes a video with a Core Image colour matrix applied (FLYP camera filters).'
  s.author         = 'FLYP'
  s.homepage       = 'https://flyp.app'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
