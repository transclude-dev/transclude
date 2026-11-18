An id inside a foreign `<template>` is not a fragment. The outline leaves it
out, and asking for it answers 404.

Source: `design/internals.md`, "Template content is not addressable, and `childNodes` is why it looks like it is."
