#!/usr/bin/env ruby
# frozen_string_literal: true

# Restores a shared "App" scheme.
#
# Why: the app scheme was auto-generated (not shared), and saving a shared
# AppUITests scheme caused Xcode to stop auto-generating it -- after which
# `xcodebuild -scheme App` fails outright. A project that cannot build its own
# app target is not a trade worth making for a test scheme, so both are now
# written explicitly.
#
# Idempotent: overwrites on each run.

require "xcodeproj"

PROJECT = File.expand_path("ios/App/App.xcodeproj", __dir__ + "/..")
project = Xcodeproj::Project.open(PROJECT)

app = project.targets.find { |t| t.name == "App" }
abort "no App target" unless app

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.set_launch_target(app)
scheme.archive_action.build_configuration = "Release"
scheme.launch_action.build_configuration = "Debug"

scheme.save_as(PROJECT, "App", true)
puts "wrote shared scheme: App"
