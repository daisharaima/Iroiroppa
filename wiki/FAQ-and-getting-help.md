# FAQ and getting help

## The basics

**Is it free?**
Yes. Iroiroppa is free software under the GNU General Public License v3 or later — free to use, study, change and share, as long as anything you build from it stays free too.

**Is it official?**
No. It is an unofficial hobby project, not made or endorsed by CELSYS. Clip Studio Paint, Companion Mode and the smartphone app belong to CELSYS. Please do not ask CELSYS for support with it.

**Why does Windows warn about it?**
The program is not signed with a paid publisher certificate. Signing would do nothing except prove who built it; it costs money every year, and this is a free project. **More info → Run anyway** is the expected path the first time.

**Does it work on macOS, iPad or Android?**
No. It is a Windows program, and it needs Clip Studio Paint running on the same Windows PC.

**Does it work with other painting programs?**
No. It speaks only Clip Studio Paint's Companion Mode protocol. Other programs have no equivalent to connect to.

## Privacy and safety

**Does it upload anything?**
No. There is no account, no telemetry, no analytics, no crash reporting. Your colours, history and layout stay on your PC.

**Does it phone home?**
Only if you press **Check for updates**, which asks GitHub for the newest release number. Nothing about you is sent.

**Does it watch my screen?**
Only while it is looking for Clip Studio Paint's QR code, and only on your machine — the image is not saved and nothing is sent anywhere. If **Connect automatically** is on, it does that while disconnected. Turn it off in **Settings ▸ General** and it never looks.

**Is it safe to leave the pairing saved?**
The pairing file is `session.json` in Iroiroppa's data folder, and it only works with your Clip Studio Paint on your PC. You can remove it any time with **Forget pairing**.

**Can it damage my artwork or my Clip Studio Paint installation?**
It does not touch files. It sends colours and commands over the same connection the phone app uses, and it never patches Clip Studio Paint. If it misbehaves, quit it — your documents are unaffected.

## Using it

**Does it need Clip Studio Paint to be open?**
Yes, to connect. You can open Iroiroppa first; it will wait and connect when Clip Studio Paint shows its QR code.

**Will it slow Clip Studio Paint down?**
It is a separate small program. On a very heavy document the live update during a drag can feel slow; turn off **Live sync while dragging**.

**Can I use my phone app at the same time?**
No — Clip Studio Paint allows one phone-side connection at a time. Close one before using the other.

**Can I use it on a second monitor while Clip Studio Paint is on the first?**
Yes, and it is a good way to use it. See [Arrange your palette](Arrange-your-palette) for popping modules out.

**Does it replace Clip Studio Paint's own colour wheel?**
It adds to it. You can keep using Clip Studio Paint's pickers; Iroiroppa follows whatever colour they set.

**Can I share my palette layout?**
Yes — **Settings ▸ Layout ▸ Export** a palette, and the other person can **Import…** it.

## About the project

**Who made it?**
The direction, feature decisions and testing come from one person who is not a programmer. The code and the prose were written by AI — DeepSeek models driven through an AI coding agent. There is a test suite and there are design notes, but no professional developer has reviewed the code.

**Why say that?**
Because it is true, and because it is fair to know what you are running. Bug reports and fixes are genuinely welcome — the project exists to be shared.

**Can I contribute?**
Yes. The repository has a guide for contributors, and honest bug reports are as useful as code.

## Getting help

There is no support desk, but there is a good way to ask.

1. Check [Troubleshooting](Troubleshooting) first — most questions are answered there.
2. If it is not covered, open an issue on the [repository](https://github.com/daisharaima/Iroiroppa/issues).

Include these, because every one of them shortens the guesswork:

- **Which version** — the Settings window shows it at the bottom.
- **Your Windows version** and **your Clip Studio Paint version**.
- **What you did**, step by step, and **what happened instead**.
- **A screenshot** if it is visual.
- **The connection state** shown in the Session panel when it went wrong.

Do not include your `session.json` or any personal document contents. If a screenshot shows your private artwork, crop it or describe it instead.

---

New to the words? The [Glossary](Glossary) explains every term used here.
