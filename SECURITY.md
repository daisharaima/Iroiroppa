# Security

Iroiroppa connects to Clip Studio Paint by impersonating the phone side of
Companion Mode. It stores the pairing secret locally and reads the QR code from
the screen. There is no server, no account and no telemetry.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's
[private security advisory](https://github.com/daisharaima/Iroiroppa/security/advisories/new)
or email the maintainer through the address on the GitHub profile.

Please include:

- the app version and build (installer/portable),
- Windows and Clip Studio Paint versions,
- what an attacker could do, and the steps to reproduce it,
- whether the pairing secret or a user's files are exposed.

There is no bug bounty. The maintainer will acknowledge a report when possible;
this is a solo project, so please allow time.

## Supported versions

Only the latest release is supported. Older builds may contain known issues.

## Scope

- The app itself, its packaged assets and its update check.
- The Companion Mode connection and the local pairing secret.
- Not in scope: Clip Studio Paint or CELSYS services, Windows, or a modified
  build you compiled yourself.
