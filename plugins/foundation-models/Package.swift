// swift-tools-version: 5.9
import PackageDescription

/*
 * Local Swift package for the FoundationModels Capacitor plugin.
 *
 * This lives inside the app repo rather than at a published package path
 * because it is specific to this app: it exposes Apple's on-device model
 * and nothing else, and it will change alongside the web code that calls it.
 * Publishing it would create a release cycle for no benefit.
 *
 * The layout mirrors the official plugins exactly -- `ios/Sources/<Name>` with
 * a `Package.swift` at the package root pointing into it -- so that if this
 * ever DOES move to a published package the structure is already correct.
 *
 * Platforms is pinned to .iOS(.v17), matching the app's deployment target, NOT
 * to .v26. The availability of the model is decided at RUNTIME by the
 * `#available(iOS 26.0, *)` checks in the plugin, which is what allows the app
 * to keep shipping to users whose device predates Apple Intelligence while
 * offering suggestions only where the model exists. Raising this to .v26 would
 * raise the whole app's floor to Apple-Intelligence-capable hardware, locking
 * out every other device for a feature they cannot have anyway.
 *
 * `FoundationModels` is a system framework on iOS 26+, and it MUST be linked
 * explicitly: `import FoundationModels` alone compiles (the SDK provides the
 * module) but leaves every symbol unresolved in the final binary, because SPM
 * does not autolink system frameworks for you. That is a silent failure -- the
 * build stays green and the call dies at runtime as a dyld lookup against a
 * framework the app never loaded. `linkerSettings` below is what fixes it, and
 * `.weak` is required so the app still launches on iOS 17-25, where the
 * framework does not exist at all. Without `.weak`, the app would fail to
 * launch on every device that does not have Apple Intelligence.
 *
 * Verified with: otool -L <App.app/App.debug.dylib> | grep -i foundationmodels
 * (must list FoundationModels.framework, marked "weak"; a blank result means
 * suggestions can never work, however green the build is. NOTE: check the
 * .debug.dylib, not the App binary -- in Debug builds the code lives in the
 * dylib and the App binary has no FoundationModels load command at all.)
 */
let package = Package(
    name: "FoundationModelsPlugin",
    platforms: [.iOS(.v17)],
    products: [
        .library(
            name: "FoundationModelsPlugin",
            targets: ["FoundationModelsPlugin"])
    ],
    dependencies: [
        .package(
            url: "https://github.com/ionic-team/capacitor-swift-pm.git",
            from: "8.0.0"
        )
    ],
    targets: [
        .target(
            name: "FoundationModelsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
            ],
            path: "ios/Sources/FoundationModelsPlugin",
            linkerSettings: [
                // See the header note. .weak because the framework only exists
                // on iOS 26+, while the app deploys to iOS 17.
                .linkedFramework("FoundationModels", .when(platforms: [.iOS]))
            ]
        )
    ]
)
