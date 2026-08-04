# Security

## Reporting

Do not open a public issue.

Use GitHub's [private reporting](https://github.com/transclude-dev/transclude/security/advisories/new),
or mail **admin@dakroub.co**. Either one reaches the same person and neither is
public until there is something to say.

Say what an attacker can do and how you got there. A page, an element or a
config that shows it is worth more than a description of one. If you are not
sure it is a security problem, report it this way anyway: deciding that is the
job of whoever reads it, not yours.

You will get a reply. If a fix is needed it goes out as a release, and you are
credited in the notes unless you would rather not be.

## Supported versions

The latest release. This project is below `1.0`, so a fix goes into the next
version rather than back into an old one.

## What this framework does about it

Not a promise, a list of what is already there, so a report can say which of
these did not hold.

- **Every `${…}` is escaped**, by text rules or attribute rules as the position
  needs. `html()` is the one way past it, and it is a claim by the author rather
  than something that can happen by accident.
- **`${…}` in a `<script>` or `<style>` is a compile error.** A value there
  would land in code, and no escape fixes that. `json()` is the narrow way
  through.
- **CSRF is on by default**, scoped to the content types an HTML form can send.
- **A Content-Security-Policy is one config key**, built from the hashes of what
  each page inlines.
- **A signed cookie cannot be forged**, and reading one is what marks a page as
  personal, so a shared cache never holds it.
- **A cross-site include is default deny.** No host named, no proxy route, and
  every redirect hop is checked again against the allowlist and the private
  address ranges.

Details are at [transclude.dev/docs/security](https://transclude.dev/docs/security).
