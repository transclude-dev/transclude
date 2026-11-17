`reportOnly: true` sends the policy to be reported, not enforced.

Source: `/docs/security`, "Report before you enforce".

Marked `todo`. The policy goes out as
`<meta http-equiv="content-security-policy-report-only">`, and browsers
ignore report-only in a `<meta>`, so its script and style rules report
nothing. Joe decided it belongs in the header. The expected page has no
`<meta>` policy.
