Pod::Spec.new do |s|
  s.name           = 'RallyCamExport'
  s.version        = '1.0.0'
  s.summary        = 'Burns the RallyCam overlay into a video on the phone'
  s.description    = 'Reads a recorded video, draws the saved overlay scene on every frame and writes a new video.'
  s.author         = ''
  s.homepage       = 'https://github.com/darrenliau/RallyCam'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
