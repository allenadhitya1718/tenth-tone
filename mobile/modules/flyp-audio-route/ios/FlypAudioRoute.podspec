Pod::Spec.new do |s|
  s.name           = 'FlypAudioRoute'
  s.version        = '1.0.0'
  s.summary        = 'Call audio output: Bluetooth, speaker, earpiece'
  s.description    = 'Reports whether a Bluetooth or wired headset is connected during a call and switches the output between it, the speaker and the earpiece.'
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
