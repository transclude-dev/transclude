`POST /?fragment=nope` answers 404 and does not run the action: the list after
it is still empty. The same form posted to `/` does run it, which is what makes
the empty list mean something.

Source: `/docs/fragments`, "Actions".
