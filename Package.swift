// swift-tools-version:5.9

import PackageDescription

let firebaseSDKVersion: Version = "12.9.0"

let package = Package(
    name: "cordova-plugin-firebasex-core",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "cordova-plugin-firebasex-core",
            targets: ["cordova-plugin-firebasex-core"]
        )
    ],
    dependencies: [
        .package(url: "https://github.com/apache/cordova-ios.git", branch: "master"),
        .package(url: "https://github.com/firebase/firebase-ios-sdk.git", exact: firebaseSDKVersion)
    ],
    targets: [
        .target(
            name: "cordova-plugin-firebasex-core",
            dependencies: [
                .product(name: "Cordova", package: "cordova-ios"),
                .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseInstallations", package: "firebase-ios-sdk")
            ],
            path: "src/ios",
            exclude: ["GoogleService-Info.plist"],
            publicHeadersPath: "."
        )
    ]
)