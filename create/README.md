# @transclude/create

Starts a [transclude](https://transclude.dev) project.

```sh
npm create @transclude my-app
cd my-app
npm install
npm run dev
```

## Templates

```sh
npm create @transclude my-app -- --template blank
```

| | |
| --- | --- |
| `minimal` | a layout, two pages, a 404 and a stylesheet. The default. |
| `blank` | one page, with a heading and a paragraph. |

Neither brings a fragment, an include or an element. Those are decisions your
project has not made yet, and the [documentation](https://transclude.dev) shows
them when you want them.

## Options

| | |
| --- | --- |
| `--template <name>` | `minimal` or `blank` |
| `--yes` | take the defaults and ask nothing |
| `--link` | depend on a local checkout of the framework rather than the registry |

With no arguments it asks for a directory and a template. Piped or in CI it asks
nothing and takes the defaults, because hanging on a prompt nobody can see is the
worse failure.

An existing directory is fine when it holds nothing that would be overwritten; a
`.git` from `git init` is the ordinary case. Anything else is refused rather than
merged.

## What it writes

Whatever is in `templates/`, with the package name, the dependency on
`@transclude/core` and the page heading filled in. Nothing is generated, so
reading that directory in this package tells you exactly what a new project is.

## License

MIT
