`app/public/` is served with byte ranges, so media works. The
`Content-Type` comes from the extension, a kind it does not know goes out as
`application/octet-stream`, and every response carries `nosniff`.

Source: `/docs/production`, "Public files".
