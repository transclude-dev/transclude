The docs flash. A post sets a short-lived signed cookie and redirects. The
next `GET` shows the message and deletes the cookie, so the `GET` after it
shows nothing. The message crosses the redirect once.

Source: `/docs/cookies`, "A flash message".
