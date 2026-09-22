#!/usr/bin/env ruby
# frozen_string_literal: true
# Assigns the signing team to the app target so Xcode will mint a certificate.
# Manual project-file edit: the GUI signing screen is unreachable on this box
# (osascript lacks assistive access), but DEVELOPMENT_TEAM is just a build
# setting, so it can be written directly.
require "xcodeproj"

TEAM = "XQBRZ94BTS"   # Brenda Morgan (Personal Team)

path = "ios/App/App.xcodeproj"
proj = Xcodeproj::Project.open(path)

changed = []
proj.targets.each do |t|
  next unless t.name == "App"          # only the app target ships to the phone
  t.build_configurations.each do |c|
    c.build_settings["DEVELOPMENT_TEAM"] = TEAM
    c.build_settings["CODE_SIGN_STYLE"] = "Automatic"
    changed << "#{t.name}/#{c.name}"
  end
end

proj.save
puts "set DEVELOPMENT_TEAM=#{TEAM} on: #{changed.join(", ")}"
