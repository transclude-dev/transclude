With `fragmentHeader: 'HX-Target'`, a request whose `HX-Target` header names a
fragment gets that fragment, with no `?fragment=` in the URL. Every answer
carries `Vary: Accept-Encoding, HX-Target`, so a cache keeps the two apart.

Source: `/docs/fragments`, the htmx example and "Strict parameter, loose
header".
