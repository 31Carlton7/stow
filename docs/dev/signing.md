# Signing and notarizing

`pnpm dist` signs and notarizes when the environment says who signs, and builds unsigned when it does
not. Nothing is in the repository but the wiring: the identity and the Apple credentials stay in the
keychain of the Mac that makes the release.

| Piece | What it does |
| --- | --- |
| `apps/desktop/scripts/pack.mjs` | Runs electron-builder. With no `CSC_NAME` or `CSC_LINK` it adds `-c.mac.identity=null` and prints `[pack] NOT SIGNING`. |
| `apps/desktop/electron-builder.yml` | The hardened runtime and `resources/entitlements.mac.plist`, used only when the build is signed. |
| `apps/desktop/scripts/notarize.cjs` | electron-builder's `afterSign` hook. Sends a signed app to Apple and staples the ticket, or prints `[notarize] SKIPPED` and why. |

## The environment

| Variable | What it is |
| --- | --- |
| `CSC_NAME` | The Developer ID Application certificate in the keychain, without the `Developer ID Application:` prefix: `Jane Appleseed (ABCDE12345)`. |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Instead of `CSC_NAME`: the certificate as a base64 `.p12` and its password. |
| `APPLE_KEYCHAIN_PROFILE` | A profile saved with `xcrun notarytool store-credentials`. The secrets stay in the keychain. |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Instead of the profile: the three raw credentials. |

## Once

1. Create a Developer ID Application certificate (Xcode, Settings, Accounts, Manage Certificates).
2. Save the notary credentials: `xcrun notarytool store-credentials stow-notary`.

## Each release

    CSC_NAME="Jane Appleseed (ABCDE12345)" APPLE_KEYCHAIN_PROFILE=stow-notary pnpm dist

Expect `[pack] signing`, a few minutes of `[notarize] sending`, then `[notarize] accepted and
stapled`. The app inside `Stow.dmg` and the zip is then signed, notarized and stapled.

The disk image itself is neither signed nor notarized by that. To have Gatekeeper pass the image as
well as the app inside it:

    codesign --sign "Developer ID Application: Jane Appleseed (ABCDE12345)" --timestamp apps/desktop/release/Stow.dmg
    xcrun notarytool submit apps/desktop/release/Stow.dmg --keychain-profile stow-notary --wait
    xcrun stapler staple apps/desktop/release/Stow.dmg

## Check what was made

    codesign -dv --verbose=2 apps/desktop/release/mac-universal/Stow.app   # Authority=Developer ID Application: …
    spctl -a -t exec -vv apps/desktop/release/mac-universal/Stow.app       # accepted, source=Notarized Developer ID
    xcrun stapler validate apps/desktop/release/mac-universal/Stow.app
    node apps/desktop/scripts/packaged-live.mjs                            # with PACKED_APP set to that app

## An unsigned build

It runs on the Mac that built it. On another Mac, Gatekeeper refuses a downloaded copy: clear the
quarantine with `xattr -cr /Applications/Stow.app`, or sign it.
