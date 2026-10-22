# CSP integration

Iroiroppa talks to Clip Studio Paint only through **Companion Mode**
("Connect to smartphone"), impersonating the phone side of that connection. It
does not load plugins into CSP, run scripts inside it, patch its files, or inject
code.

The wire protocol is observational and documented in `docs/PROTOCOL.md`. Other
integration routes were evaluated during development but are not part of the
shipped app; their notes are kept privately and are not needed to build, test or
use Iroiroppa.

Companion Mode is undocumented and can change in any CSP update. Iroiroppa is
unofficial and not affiliated with CELSYS, Inc.
