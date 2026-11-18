`cookies.signed` needs `cookieSecret`. Without one, reading a signed cookie
and writing one both throw, and the request answers 500.

Source: `/docs/cookies`, "Signing".
