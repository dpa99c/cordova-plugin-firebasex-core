# Version 2.0.1
- Move FirebasePluginMessageReceiver from core plugin to messaging plugin.
	- Resolves [#1](https://github.com/dpa99c/cordova-plugin-firebasex-core/issues/1)
- fix(ios): configure Firebase before plugin init under cordova-ios 8 scene lifecycle
	- Resolves [#4](https://github.com/dpa99c/cordova-plugin-firebasex-core/issues/4)
	- Merged from [PR #5](https://github.com/dpa99c/cordova-plugin-firebasex-core/pull/5)
- fix: add types field to package.json so TypeScript resolves type definitions
	- Merged from [PR #3](https://github.com/dpa99c/cordova-plugin-firebasex-core/pull/3)

# Version 2.0.0
- (ios) feat - BREAKING: Use Swift Package Manager (SPM) for Firebase SDK and other dependencies with `cordova-ios@8+`; continue to use Cocoapods for `cordova-ios@7`.
- (android) Update pinned Firebase SDK versions to BoM v34.14.0 (May 28, 2026)
	- https://firebase.google.com/support/release-notes/android#2026-05-28
- (ios) Update pinned Firebase SDK version to v12.14.0 (May 26, 2026)
	- https://firebase.google.com/support/release-notes/ios#version_12140_-_may_26_2026	

# Version 1.0.3
- fix: correct GradlePluginGoogleServicesEnabled target and remove dead code.
- (android) Remove accent color as it's specific to notifications so belongs in `cordova-plugin-firebasex-messaging`.

# Version 1.0.2
- (ios) Fix hook script compatibility with cordova-ios@8

# Version 1.0.1
- Fix plugin metadata


# Version 1.0.0
- Initial release of the modular plugin.
    - See [CHANGELOG](https://github.com/dpa99c/cordova-plugin-firebasex/blob/master/CHANGELOG.md) for the full changelog of the main plugin which includes this module as a dependency.