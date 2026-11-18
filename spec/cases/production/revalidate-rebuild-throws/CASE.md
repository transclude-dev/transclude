A rebuild that throws leaves the held page where it is, so one bad render
does not empty the store. The error goes to `onError` with the request that
started it, in the phase `revalidate`.

Source: `/docs/production`, "Holding a render".
