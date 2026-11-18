A store shared by several servers is a network away, so its methods return
promises. The docs ask for "anything with the same four methods". The same
requests as `cache-store`, against a store whose methods are async.

Source: `/docs/production`, the end of "Tags".

The expected files are `cache-store`'s, copied: the same requests to a store
that answers later must come out the same.
