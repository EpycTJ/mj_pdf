<div align="center">

<img src="assets/logo/logo.webp" width="110" alt="MJ PDF logo"/>

**MJ PDF** is a fast, simple, powerful and totally private PDF reader made by [Mudlej](https://mudlej.com).

[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-3.0.0-2ea44f.svg)](change_log.md)
[![API](https://img.shields.io/badge/API-23%2B-brightgreen.svg)](https://developer.android.com/about/versions/marshmallow)
[![IzzyOnDroid](https://img.shields.io/endpoint?url=https://apt.izzysoft.de/fdroid/api/v1/shield/com.gitlab.mudlej.MjPdfReader)](https://apt.izzysoft.de/fdroid/index/apk/com.gitlab.mudlej.MjPdfReader)

</div>

<div align="center">

<a href="https://mudlej.com/projects/mj-pdf"><img src="assets/buttons/official_page.png" height="88" alt="The official MJ PDF page on mudlej.com"/></a>

<br/>

<a href="https://apt.izzysoft.de/fdroid/index/apk/com.gitlab.mudlej.MjPdfReader"><img src="assets/buttons/izzy.png" height="60" alt="Get it on IzzyOnDroid"/></a>
<a href="https://mudlej.com/mj-pdf.apk"><img src="assets/buttons/direct_apk.png" height="60" alt="Direct APK download"/></a>
<a href="https://gitlab.com/mudlej_android/mj_pdf_reader"><img src="assets/buttons/gitlab.png" height="60" alt="Source code on GitLab"/></a>
<a href="https://github.com/mudlej/mj_pdf/"><img src="assets/buttons/github.png" height="60" alt="GitHub mirror"/></a>

<sub>F-Droid main repo and Play Store are not available for now, see the <a href="https://mudlej.com/projects/mj-pdf#faq">FAQ</a>.</sub>

</div>

## Screenshots
| Home | Library | Highlight & Select |
|:-:|:-:|:-:|
| <img src="assets/screenshots/home_recent.webp" alt="Home" width="250"/> | <img src="assets/screenshots/home_library.webp" alt="Library" width="250"/> | <img src="assets/screenshots/selection_highlight.webp" alt="Highlight and select text" width="250"/> |
| **Dark Mode** | **Reader Menu** | **Share Quotes** |
| <img src="assets/screenshots/reader_dark.webp" alt="Dark mode" width="250"/> | <img src="assets/screenshots/reader_menu.webp" alt="Reader menu" width="250"/> | <img src="assets/screenshots/quote_share.webp" alt="Share quotes as images" width="250"/> |

More screenshots are in the [MJ PDF Gallery](http://mudlej.com/projects/mj-pdf/supplements/gallery/).

## What's new in 3.0
Check MJ PDF v3.0.0's [**Official Release Page**](http://mudlej.com/projects/mj-pdf/supplements/v3.0.0-release/)

Version 3.0 is the biggest update in MJ PDF's history, closer to a rewrite of the app. The short version:

- A new Home screen with a library, reading statuses, recent files, and a real folder browser.
- Highlight text, add notes, and save them into the PDF.
- Draw handwritten signatures and save them into the PDF.
- Fill PDF forms.
- A new Text Mode that reads like an e-book.
- Turn selected text into a beautiful, shareable quote image.
- Translate selected text and define words with an offline dictionary.
- Dual page mode, RTL reading, hide margins, incognito mode.
- User bookmarks and browser-like navigation history.
- Backup and restore for your data.
- Much faster rendering after rebuilding PDFium for speed.

The full list is in the [changelog](change_log.md).

## MJ PDF Features

**Library**
- Home screen with three tabs: Recent, Library, and Folders.
- Continue reading right where you left off, with a detailed reading history.
- Reading statuses: to-read, reading, on-hold, completed, abandoned.
- Cover grid or list view, with adjustable grid size and sorting.
- The Folders tab is a real file manager with breadcrumbs and SD-card support.
- Search every PDF on your device.
- Reading progress and statuses survive file moves and renames.

**Reader**
- Fast, simple, and very lightweight.
- Dark mode for the app and for the PDF itself.
- True full screen with configurable buttons, reading progress, time, and page info.
- Rotate, brightness bar, auto-scroll with adjustable speed, zoom lock, screenshots.
- Dual page mode that pairs pages like an open book.
- Hide PDF margins to make the page fill your screen.
- Right-to-left reading with automatic detection.
- Open password-protected PDFs and online PDFs through links.
- Share and print PDFs. Open multiple instances at the same time.
- Mouse wheel and mouse button support, volume-key page turning.

**Highlights, signatures, and forms**
- Highlight text and save the highlights into the PDF file.
- Attach notes to highlights, browse them in My Notes and My Highlights pages.
- Edit highlights that already exist in the document.
- Draw a handwritten signature once, reuse it anywhere, saved as sharp vector strokes.
- Fill PDF forms.
- Select text inline with copy, share, web-search, translate, and dictionary actions.
- Share quotes as images, with the book's name and a choice of themes.

**Search and navigation**
- Very fast and powerful search with live streaming results.
- Next and previous result navigation from inside the reader.
- A page for the full Table of Contents, with search.
- A page for all the links embedded in the PDF.
- User bookmarks with custom names and chapter context.
- Browser-like back and forward navigation history.

**Text Mode**
- Read any PDF like an e-book.
- Text reflow, multiple fonts, themes, and adjustable line length.

**Privacy**
- Open source with total privacy.
- No data collection, no ads, no tracking.
- Incognito mode that saves nothing about what you read.

## Permissions and privacy
This app does not collect any data.
The following permissions are required to provide specific features in the app:
* *Internet*: For opening PDFs through links
* *Storage / all-files access*: For scanning, opening, and managing the PDFs on your device

Exodus privacy reports a tracker in MJ PDF. That is ACRA, the crash reporter, and it does **NOT** send anything unless you explicitly press SEND on the dialog that appears after a crash. Its configuration is [in the code](app/src/main/java/com/gitlab/mudlej/MjPdfReader/App.kt), and there is more detail in the [FAQ](https://mudlej.com/projects/mj-pdf#faq).

## How to build
```sh
git clone https://gitlab.com/mudlej_android/mj_pdf_reader.git
cd mj_pdf_reader
./gradlew assembleDebug
```

That is enough for the app itself, since prebuilt native libraries are included.

- To set up a build environment from a fresh Linux install, see [SETUP.md](SETUP.md).
- To rebuild the native libraries (PDFium, FreeType, libpng, and the JNI bridge), use the scripts in [build_dependencies](build_dependencies/). Since 3.0.0, PDFium is built from source and optimized for speed instead of size, which fixed a years-old rendering slowdown.
- After editing `mainJNILib.cpp`, go to `PdfiumAndroid/src/main/jni` and run `ndk-build`. Every future build will use the generated libs.

The repository is three modules:

| Module | Role |
|---|---|
| `app` | The MJ PDF application |
| `AndroidPdfViewer` | MJ PDF's viewer library: rendering, gestures, text selection, highlights |
| `PdfiumAndroid` | MJ PDF's bindings to the PDFium engine |

## Contributing
- **Bugs and requests**: open an issue on [GitLab](https://gitlab.com/mudlej_android/mj_pdf_reader/-/issues). If you do not have a GitLab account, use the [GitHub mirror](https://github.com/mudlej/mj_pdf/).
- **Translations**: MJ PDF is available in 15 languages: Arabic, Chinese, Dutch, English, French, German, Hindi, Italian, Persian, Polish, Portuguese (Brazil), Russian, Spanish, Ukrainian and Turkish. To add or improve one, edit `app/src/main/res/values-<lang>/strings.xml` and open a merge request.

## Authors and acknowledgment
- MJ PDF is made by [Mudlej](https://mudlej.com). The full story is on the [official page](https://mudlej.com/projects/mj-pdf).
- MJ PDF v1 and v2 were based on PDF Viewer Plus by Gokul Swaminathan ([@JavaCafe01](https://github.com/JavaCafe01)), who discontinued his app and recommended MJ PDF as its replacement. The app in v3.0.0 since been entirely rewritten.
- [@barteksc](https://github.com/barteksc) wrote the original viewer and PDFium binding libraries that MJ PDF's PDF stack grew from.
- Credits to [@Derekelkins](https://github.com/Derekelkins) for adding the ability to remember the last opened page to the original app.
- Big thanks to [Bnyro](https://gitlab.com/Bnyro) (LibreTube's dev) for helping me with the colors and the migration to M3. (MJ PDF v2.1)
- Community translators brought the app to 15 languages.

## License
MJ PDF uses the GPLv3 license. The original app (PDF Viewer Plus) was under the MIT license.
