# Security Policy

## Supported versions

Security fixes go into the latest release. Please update to it before reporting.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report them privately through GitHub:
[Report a vulnerability](https://github.com/D3FXgit/AetherStar/security/advisories/new)
(repository **Security** tab, then **Report a vulnerability**).

Include what you found, how to reproduce it, and which version and operating system you used. You
should get a first reply within a week. Once a fix is released, the advisory is published and you
are credited unless you prefer not to be.

## Scope

Of particular interest:

- Ways for a song folder (chart, media or cover file) to run code, read files outside the library,
  or escape the renderer sandbox.
- Ways for the renderer to reach main-process functionality beyond the named preload API.
- Bypasses of the Content-Security-Policy or the navigation block.
