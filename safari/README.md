# Safari build

This folder contains the helper to convert the extension into a Safari Web Extension.

## Why this is needed

Safari doesn't have a "Load unpacked extension" mode like Chrome/Edge/Brave. Every Safari Web Extension must be wrapped in a tiny native macOS app and built with Xcode. Apple ships a one-command converter that does the wrapping for you (`safari-web-extension-converter`), and `build-safari.sh` just calls it.

## Behavior differences vs. Chrome

| Feature | Chrome / Edge / Brave / Arc | Safari |
|---------|------------------------------|--------|
| Auto-append to a CSV file on disk | Yes (File System Access API) | **No** (Safari doesn't support `showSaveFilePicker`) |
| "Download CSV" button in popup | Yes | Yes |
| Profile detection & dedup | Yes | Yes |
| Storage of rows | `chrome.storage.local` + file mirror | `chrome.storage.local` only |
| Install method | Load Unpacked | Xcode build + Safari Settings toggle |

On Safari, the workflow is: browse LinkedIn → rows accumulate inside the extension → open the popup whenever you want and click **Download CSV** to export them all to your Downloads folder. The "Choose CSV file…" / "Resume tracking" buttons are hidden on Safari because the underlying API doesn't exist there.

## Build steps

```bash
# Prereqs (one time):
#   1. Install Xcode from the Mac App Store.
#   2. xcode-select --install
#   3. sudo xcodebuild -license accept

cd safari
chmod +x build-safari.sh
./build-safari.sh
```

The script produces an Xcode project at `safari/build/LinkedInProfileTracker/`.

Then in Xcode:

1. `open safari/build/LinkedInProfileTracker/LinkedInProfileTracker.xcodeproj`
2. Click the ▶ Run button. A small host app named "LinkedInProfileTracker" launches; you can quit it immediately.
3. Open Safari → Settings → Extensions → enable **LinkedIn Profile Tracker**.
4. If it doesn't appear, go to Safari → Develop menu → **Allow Unsigned Extensions** (the Develop menu has to be enabled in Safari → Settings → Advanced → "Show features for web developers").
5. Click the extension's toolbar icon → grant permission for `linkedin.com`.

## Distributing to a non-developer

There is no "send a friend a .crx" equivalent in Safari. To give the extension to someone who isn't going to build it themselves you have to either:

- Have them follow these same Xcode steps (free, but ~10 GB of Xcode and command-line comfort).
- Publish it on the Mac App Store ($99/yr Apple Developer Program + App Store review).
- Notarize and distribute the host app directly ($99/yr Apple Developer Program).

For most personal use cases, it's significantly easier to ask the recipient to install Chrome, Edge, or Brave and use the unsigned-extension path documented in the root README.
