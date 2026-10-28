# FAQ

**Is Iroiroppa free?**
Yes. It is free software under GPL-3.0-or-later: use, study, change and share it, provided derivative works stay free.

**Is it official?**
No. It is independent and not affiliated with CELSYS. Do not ask CELSYS for support.

**Why does Windows warn about it?**
The app is not signed with a paid publisher certificate. Signing proves the publisher and avoids most SmartScreen warnings, but a certificate has a yearly cost. Choose **More info → Run anyway** on first launch.

**Does it run on macOS, iPad or Android?**
No. It is a Windows app and needs Clip Studio Paint on the same PC.

**Does it work with other painting programs?**
No. It uses Clip Studio Paint's Companion Mode.

**Does it upload my data?**
No account, telemetry or analytics. With **Auto** on, it requests the latest release number from GitHub at startup and daily. Colors, history and layouts stay on the PC.

**Does it read the screen?**
Only to find the QR code, locally. It does not save or upload the image. Turn off **Connect automatically** to stop scanning.

**Can it damage my artwork or Clip Studio Paint?**
No. It does not modify your artwork or Clip Studio Paint's program files. It sends colors and commands over the same connection as the phone app.

**Can I use the phone app at the same time?**
No. Clip Studio Paint allows one phone-side connection at a time.

**Can I share a palette?**
Yes. Export it from **Settings → Layout**; the other person imports the file.

**Who makes it?**
An independent developer directs the project; the code and text are written with AI assistance. The code has a test suite but no professional developer review.

**Where do I report a problem?**
Open an issue on the [repository](https://github.com/daisharaima/Iroiroppa/issues) and include:

- Iroiroppa version (Settings footer);
- Windows and Clip Studio Paint versions;
- steps to reproduce and the result;
- a screenshot, if visual;
- the connection state from the Session dot's tooltip.

Do not include `session.json` or private artwork.
