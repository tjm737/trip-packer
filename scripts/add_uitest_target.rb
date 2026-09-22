#!/usr/bin/env ruby
# frozen_string_literal: true

# Adds a UI test target to the Capacitor app project.
#
# Why: this machine's Xcode is a trimmed 3.9 GB copy with no Simulator.app, so
# `simctl` is all we have -- and it has no tap command. UI tests are the one
# remaining way to deliver a real tap to the app, because xcodebuild test drives
# XCTRunner.app against the simulator with no GUI involved.
#
# Idempotent: re-running finds the existing target and leaves it alone.

require "xcodeproj"

PROJECT = File.expand_path("ios/App/App.xcodeproj", __dir__ + "/..")
TARGET_NAME = "AppUITests"

project = Xcodeproj::Project.open(PROJECT)

if project.targets.any? { |t| t.name == TARGET_NAME }
  puts "target #{TARGET_NAME} already exists; nothing to do"
  exit 0
end

app_target = project.targets.find { |t| t.name == "App" }
abort "no App target found" unless app_target

test_target = project.new_target(
  :ui_test_bundle,
  TARGET_NAME,
  :ios,
  app_target.deployment_target
)

# Link the app under test. Without TEST_TARGET_NAME the runner has nothing to
# launch and the test fails at startup rather than at an assertion.
test_target.add_dependency(app_target)
test_target.build_configurations.each do |config|
  config.build_settings["TEST_TARGET_NAME"] = "App"
  config.build_settings["PRODUCT_BUNDLE_IDENTIFIER"] = "com.tylermorgan.tripplanner.uitests"
  config.build_settings["SWIFT_VERSION"] = "5.0"
  config.build_settings["GENERATE_INFOPLIST_FILE"] = "YES"
  config.build_settings["CODE_SIGNING_ALLOWED"] = "NO"
  # PRODUCT_NAME is required. xcodeproj's new_target does not set it, and without
  # it the UI-test runner bundle is named "-Runner.app" (empty prefix), which
  # collides with a second empty-named target and fails the build with
  # "Multiple commands produce .../-Runner.app/PlugIns/.xctest".
  config.build_settings["PRODUCT_NAME"] = TARGET_NAME
  config.build_settings["PRODUCT_MODULE_NAME"] = TARGET_NAME
end

# The test file itself.
group = project.main_group.new_group(TARGET_NAME, "AppUITests")
source = group.new_file("MapRenderTests.swift")
test_target.add_file_references([source])

project.save
puts "added #{TARGET_NAME} and wired TEST_TARGET_NAME=App"
