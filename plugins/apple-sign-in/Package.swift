// swift-tools-version: 5.9
import PackageDescription

/*
 * Local Swift package for the Sign in with Apple Capacitor plugin.
 *
 * Lives in the app repo rather than at a published path because it is specific
 * to this app's bundle id and team, and changes alongside the web code that
 * calls it.
 *
 * Platforms is pinned to .iOS(.v13), which is where ASAuthorizationController
 * gained the Sign in with Apple flow. This is a HARD floor, unlike the
 * FoundationModels package next door where availability is decided at runtime:
 * there is no runtime check that can make the API exist on an older OS, so the
 * package simply requires what the API requires. The app's own deployment
 * target is iOS 15, which is above this, so nothing is locked out.
 *
 * AuthenticationServices is a system framework, referenced via the SDK with no
 * package dependency.
 */
let package = Package(
    name: "AppleSignInPlugin",
    platforms: [.iOS(.v13)],
    products: [
        .library(
            name: "AppleSignInPlugin",
            targets: ["AppleSignInPlugin"])
    ],
    dependencies: [
        .package(
            url: "https://github.com/ionic-team/capacitor-swift-pm.git",
            from: "8.0.0"
        )
    ],
    targets: [
        .target(
            name: "AppleSignInPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
            ],
            path: "ios/Sources/AppleSignInPlugin"
        )
    ]
)
