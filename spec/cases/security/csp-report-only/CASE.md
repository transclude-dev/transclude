`reportOnly: true` sends the whole policy, this page's hashes and the
header-only directives together, as a `Content-Security-Policy-Report-Only`
header, on a prerendered page and on a rendered one. No `<meta>` policy is
written, because a browser ignores report-only in one, and no enforcing header
is sent.

Source: `/docs/security`, "Report before you enforce".
