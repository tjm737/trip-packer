#!/usr/bin/env ruby
# frozen_string_literal: true

# Creates a shared scheme that runs AppUITests against App.
#
# Why: xcodebuild test needs a scheme whose Test action references the UI test
# target. Adding the target alone leaves no scheme to invoke, so `xcodebuild
# -scheme App test` would run zero tests and still exit 0 -- a silent pass.
#
# Also removes AppUITests from the App scheme's Test action, so the two never
# both run.
#
# Idempotent: overwrites the scheme on each run.

require "xcodeproj"

PROJECT = File.expand_path("ios/App/App.xcodeproj", __dir__ + "/..")
project = Xcodeproj::Project.open(PROJECT)

app = project.targets.find { |t| t.name == "App" }
tests = project.targets.find { |t| t.name == "AppUITests" }
abort "missing App or AppUITests target" unless app && tests

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_test_target(tests)
scheme.set_launch_target(app)

# UI tests launch the app themselves via XCUIApplication(), so the scheme must
# not start a second instance. Disabling the run action's launch avoids the
# app-already-running conflict.
scheme.launch_action.build_configuration = "Debug"
scheme.test_action.build_configuration = "Debug"

# Stop after the first failure so a broken map test does not produce a wall of
# cascading assertions that hide the root cause.
scheme.test_action.code_coverage_enabled = false

path = Xcodeproj::XCScheme.shared_data_dir(PROJECT)
FileUtils.mkdir_p(path)
out = File.join(path, "AppUITests.xcscheme")
scheme.save_as(PROJECT, "AppUITests", true)
puts "wrote #{out}"
