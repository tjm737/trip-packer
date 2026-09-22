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
 * Platforms is pinned to .iOS(.v15), matching the app's deployment target, NOT
 * to .v26. The availability of the model is decided at RUNTIME by the
 * `#available(iOS 26.0, *)` checks in the plugin, which is what allows the app
 * to keep shipping to iOS 15 users while offering suggestions only where the
 * model exists. Raising this to .v26 would raise the whole app's floor and
 * lock out every older device for a feature they cannot have anyway.
 *
 * `FoundationModels` is a system framework on iOS 26+, so it is referenced by
 * the compiler via the SDK and needs no package dependency. Building against
 * an SDK that lacks it will fail here -- which is the correct, loud failure.
 */
let package = Package(
    name: "FoundationModelsPlugin",
    platforms: [.iOS(.v15)],
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
            path: "ios/Sources/FoundationModelsPlugin"
        )
    ]
)
