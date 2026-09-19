# Voxli Book Reader

Voxli Book Reader is a lightweight Manifest V3 browser extension for reading
local **EPUB** and **FB2** files.

![Voxli Book Reader](store-assets/promo-marquee-1400x560.jpg)

The project keeps one copy of the shared extension code and separate platform
files for Chromium-based browsers and Firefox. Store uploads are generated as
standalone ZIP archives with `manifest.json` at the archive root.

## Features

- Open local `.epub` and `.fb2` books.
- Continue reading the last opened book.
- Table of contents navigation and chapter switching.
- Reading progress tracking per book.
- Reader customization:
  - font size and family;
  - line height;
  - content width;
  - text alignment;
  - light, dark and sepia themes.
- Localized UI: English, Russian, German, French, Simplified Chinese and Traditional Chinese.

## Privacy and permissions

Voxli Book Reader works fully on-device:

- it does not upload books to external servers;
- it does not collect personal data;
- it does not use analytics or tracking scripts.

All reading data is stored locally in browser extension storage. The privacy
policy is available in [PRIVACY.md](PRIVACY.md).

The extension requests only:

- `storage` — save user settings and reading progress;
- `unlimitedStorage` — keep large local book cache/progress data.

## Repository structure

```text
common/
├── _locales/          # Shared translations
├── icons/             # Shared extension icons
├── src/               # Shared reader, parsers and UI logic
├── filepicker.html
├── options.html
├── reader.html
└── styles.css

platforms/
├── chromium/
│   ├── manifest.json  # Chromium MV3 service worker manifest
│   └── src/background.js
└── firefox/
    ├── manifest.json  # Gecko ID and AMO data declaration
    └── src/background.js

scripts/package.sh     # Creates a store-ready ZIP
tests/test_parsers.html # Manual parser test page
extension-release/
├── chrome/            # Chrome archives
├── opera/             # Existing Opera release history
└── firefox/           # Firefox archives
```

The shared files are stored only in `common/`. Platform directories contain
only files that differ between browser families. The packaging script creates a
temporary staging directory, combines `common/` with one platform variant and
removes the staging directory after creating the ZIP. The staging directory is
never included in the archive.

## Local development

This project is plain JavaScript and has no build step for development.

### Chromium-based browsers

Open the browser's extensions page (`chrome://extensions`, `edge://extensions`,
`opera://extensions` or the equivalent page), enable **Developer mode**, choose
**Load unpacked**, and select a temporary unpacked tree created by the packaging
script. Because the unpacked directory must contain a manifest at its root, do
not select `common/` directly:

```bash
rm -rf /tmp/voxli-chromium
rm -rf /tmp/voxli-release
RELEASE_ROOT=/tmp/voxli-release bash scripts/package.sh chromium
unzip -q /tmp/voxli-release/chrome/voxli-book-reader-chrome-v1.0.12.zip -d /tmp/voxli-chromium
```

Then select `/tmp/voxli-chromium` with **Load unpacked**.

### Firefox

For temporary Firefox testing, build a temporary unpacked tree:

```bash
rm -rf /tmp/voxli-firefox
rm -rf /tmp/voxli-release
RELEASE_ROOT=/tmp/voxli-release bash scripts/package.sh firefox
unzip -q /tmp/voxli-release/firefox/voxli-book-reader-firefox-v1.0.12.zip -d /tmp/voxli-firefox
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**,
and select `/tmp/voxli-firefox/manifest.json`.

The temporary extension is removed by Firefox after a browser restart. A
signed AMO package is required for persistent installation.

### Parser test page

Serve the repository over HTTP and open `tests/test_parsers.html`. The page
imports parser modules from `common/src/` and is not included in store ZIPs.

## Packaging

The script requires Bash, Python 3 and the `zip` utility. It reads the version
from the selected platform manifest.

Create the Chromium package for Chrome Web Store and other Chromium-compatible
channels:

```bash
bash scripts/package.sh chromium
```

Output:

```text
extension-release/chrome/voxli-book-reader-chrome-v1.0.12.zip
```

Create the Edge Add-ons package explicitly:

```bash
bash scripts/package.sh edge
```

Output:

```text
extension-release/edge/voxli-book-reader-edge-v1.0.12.zip
```

The Edge package uses the same Chromium Manifest V3 files as the Chrome
package. Upload the ZIP itself to Microsoft Partner Center; do not upload the
repository directory or a ZIP containing an extra top-level folder.

Create the Opera package from the same Chromium variant:

```bash
bash scripts/package.sh opera
```

Output:

```text
extension-release/opera/voxli-book-reader-opera-v1.0.12.zip
```

The script refuses to overwrite an existing archive. This protects historical
releases and the Opera package already sent for moderation. To replace an
archive deliberately, set `FORCE=1`:

```bash
FORCE=1 bash scripts/package.sh chromium
```

Create the Firefox package for AMO:

```bash
bash scripts/package.sh firefox
```

Output:

```text
extension-release/firefox/voxli-book-reader-firefox-v1.0.12.zip
```

Upload the Firefox ZIP to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/addon/submit/).
The Firefox variant includes a stable Gecko extension ID and declares that it
does not collect data. The current AMO package targets Firefox Desktop only;
Firefox for Android compatibility is not claimed. AMO may request source code
for bundled or minified third-party code during review; keep the repository
source and the JSZip license information available.

The archive contains only extension files and always has this shape:

```text
manifest.json
options.html
filepicker.html
reader.html
styles.css
_locales/
icons/
src/
```

The script does not package the repository root, `common/`, `platforms/`,
`.tmp/`, tests, documentation or previous release archives.

## Browser variants

- `platforms/chromium/` is used for Chrome, Edge, Opera, Brave, Vivaldi and
  Yandex Browser. It uses a Manifest V3 module service worker.
- `platforms/firefox/` is used for Firefox. It adds the Gecko extension ID and
  `data_collection_permissions.required: ["none"]`, and uses the Firefox
  background-script form.

The current Opera release was already submitted for moderation before this
layout change. Files in `extension-release/opera/` are historical release
archives and are not modified by the new packaging script.

## Third-party libraries

The extension bundles **JSZip v3.10.1** as `common/src/vendor/jszip.min.js` for
reading EPUB archives locally. It is distributed under the MIT or GPLv3 license
according to the bundled library header and upstream license text.

- Project: https://stuk.github.io/jszip/
- Source repository: https://github.com/leszavr/voxli_book_reader

## Version

Current extension version: `1.0.12`
