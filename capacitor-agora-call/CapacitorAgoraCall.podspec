require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'CapacitorAgoraCall'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'UNLICENSED'
  s.homepage = 'https://flyp-sa.com'
  s.author = 'FLYP'
  s.source = { :git => 'https://flyp-sa.com', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '13.0'
  s.dependency 'Capacitor'
  # The AUDIO-only SDK, not AgoraRtcEngine_iOS. Video calls stay on the web
  # SDK inside the WebView, so none of the video pipeline is wanted here - and
  # the audio pod is a fraction of the size, which matters because every
  # megabyte here is a megabyte on a phone.
  #
  # Pinned exactly. An SDK that moves under a build nobody can compile locally
  # is a failure nobody would see coming; 4.6.4 is the version this plugin was
  # written against.
  s.dependency 'AgoraAudio_iOS', '4.6.4'
  s.swift_version = '5.1'
end
