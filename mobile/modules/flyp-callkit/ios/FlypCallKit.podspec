Pod::Spec.new do |s|
  s.name           = 'FlypCallKit'
  s.version        = '1.0.0'
  s.summary        = 'FLYP incoming calls on iPhone: PushKit VoIP pushes reported to CallKit.'
  s.description    = 'Shows the native iPhone call screen for FLYP calls, the way WhatsApp does.'
  s.license        = 'UNLICENSED'
  s.author         = 'FLYP'
  s.homepage       = 'https://flyp-sa.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'CallKit', 'PushKit', 'AVFAudio'
  s.source_files   = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
