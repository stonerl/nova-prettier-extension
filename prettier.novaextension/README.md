# Prettier⁺ for Nova

Experience seamless code formatting with Prettier directly in Nova.

![GitHub Release](https://img.shields.io/github/v/release/stonerl/nova-prettier-extension)
[![Install in Nova](https://img.shields.io/badge/install%20in-nova-blueviolet?style=flat)](https://extensions.panic.com/extensions/stonerl/stonerl.prettier)
[![Join us on Gitter](https://img.shields.io/badge/chat-gitter-%23ED1965?logo=gitter&logoColor=white)](https://matrix.to/#/#prettier+nova:gitter.im)
[![Translate on Weblate](https://img.shields.io/badge/translate-weblate-brightgreen?logo=weblate&logoColor=white)](https://hosted.weblate.org/projects/prettier-for-nova/)

## Features

- **Format on Save:** Automatically format your code on save
  (this setting can be customized per project), or manually format using
  `Editor > Prettier⁺ > Format Document` (**⌥⇧F**).
- **Format Document (Forced):** Ignores `.prettierignore` and Ignored Syntaxes,
  formatting anyway via `Editor > Prettier⁺ > Format Document (Forced)`.
- **Format Selection:** Precisely formats only the highlighted portion of your code
  (currently supports JavaScript, TypeScript, GraphQL, and Handlebars).
- **Language Support:** Supports all Prettier-supported languages, including
  `Angular`,
  `CSS`,
  `Flow`,
  `GraphQL`,
  `HTML`,
  `JavaScript`,
  `JSON`,
  `JSX`,
  `Less`,
  `Markdown`,
  `SCSS`,
  `TypeScript`,
  `Vue`, and
  `YAML` —
  plus additional ones via bundled plugins, such as
  `Java`,
  `Liquid`,
  `PHP`,
  `SQL`, and
  `XML`.

- **Configuration Support:** Compatible with [standard Prettier configuration](https://prettier.io/docs/configuration),
  and [.prettierignore](https://prettier.io/docs/ignore) files.
- **Plugin Usage:** Utilizes Prettier and any plugins installed in your project,
  or defaults to the bundled Prettier and plugins if none are installed.

This extension can be used as a drop-in replacement for the original [Prettier Extension](https://extensions.panic.com/extensions/alexanderweiss/alexanderweiss.prettier/).

## Bundled plugins

- ✅ **[@prettier/plugin-php](https://github.com/prettier/plugin-php)**
- ✅ **[@prettier/plugin-xml](https://github.com/prettier/plugin-xml)**
- ✅ **[prettier-plugin-sql](https://github.com/un-ts/prettier/tree/master/packages/sql)**
- ➕ **[prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)**
- ⚠️ **[prettier-plugin-liquid](https://github.com/Shopify/theme-tools/tree/main/packages/prettier-plugin-liquid)**
- ⚠️ **[prettier-plugin-java](https://www.jhipster.tech/prettier-java/)**
- ⚠️ **[prettier-plugin-properties](https://github.com/eemeli/prettier-plugin-properties)**
- ⚠️ **[prettier-plugin-nginx](https://github.com/jxddk/prettier-plugin-nginx)**

### Plugin Legend

- ✅ **Enabled by default**

  These plugins are active out of the box—no setup required.

- ➕ **Optional, self-contained**

  Not enabled by default, but can be used immediately without installing anything extra.

- ⚠️ **Requires external extension**

  Before enabling any of the following plugins, make sure the corresponding Nova language extensions are installed:

  - `prettier-plugin-liquid`
    ➤ Requires the [Liquid](https://extensions.panic.com/extensions/me.arthr/me.arthr.Liquid/)
    extension

  - `prettier-plugin-java` and `prettier-plugin-properties`
    ➤ Requires the [Java Language Definition](https://extensions.panic.com/extensions/me.frmr/me.frmr.JavaLanguage/)
    extension

  - `prettier-plugin-nginx`
    ➤ Requires the [NGINX for Nova](https://extensions.panic.com/extensions/joncoole/joncoole.nginx)
    extension

## Using external plugins in your project

To use external Prettier plugins, simply install them along with Prettier in
your project.

## Configuring Prettier⁺

Prettier⁺ automatically detects any supported configuration files in your project,
including those located in subfolders (e.g. in monorepos), and uses them by default.

If no configuration files are found, Prettier⁺ will fall back to the options set
in the extension or project settings.

You can also force Prettier⁺ to always use these settings — even if configuration
files are present — by enabling the `Ignore Configuration Files` option.

Additionally, you can specify a global configuration file in the extension or
workspace settings. When set, this file takes precedence over all other
configurations — project settings, local configuration files, and extension
defaults will be ignored.

## Ignoring files

You can disable `Format on Save` for remote documents, documents without a Prettier
configuration file, or specific syntaxes in the extension and project settings.
Additionally you can use Prettier's [built-in exclusion](https://prettier.io/docs/ignore#ignoring-files-prettierignore)
feature by adding a `.prettierignore` file to the root of your project.

_Note: adding it anywhere else won't work._

## Using a different version of Prettier

To use a specific version of Prettier (v2.0 or higher—though the latest version
is recommended), simply install it in your project’s root directory.
The extension will automatically detect and use it.

You can also explicitly specify an installation of Prettier
(or [`prettier-eslint`](https://github.com/prettier/prettier-eslint))
by setting the `Prettier module` path in the extension or project settings.

If Prettier⁺ does not automatically pick up the change, you can manually restart
the service via `Extensions > Prettier⁺ > Restart Prettier Service` (**⌃⇧⌘R**).

## Using Prettier forks or prettier-eslint

You can use any Prettier fork that adheres to the same API,
as well as [`prettier-eslint`](https://github.com/prettier/prettier-eslint),
by explicitly specifying the `Prettier module` path in the extension or project settings.

## Working with remote files

Most features are supported for remote files; however,
[Prettier configuration](https://prettier.io/docs/configuration.html) and
[.prettierignore](https://prettier.io/docs/ignore.html) files are not.
Instead, the default configuration set in the extension or project settings will
be used.

## Versioning

Prettier⁺ for Nova follows [Semantic Versioning](https://semver.org/),
aligned with official Prettier releases. Versions are formatted as `a.b.c`, where:

- `a.b` corresponds to the bundled Prettier version.
- `c` is the extension’s specific build number
  (used for fixes or enhancements unrelated to the Prettier core).

For example, `3.5.4` uses Prettier `v3.5.x` and is the fourth extension build.

## Contributing Translations

[![Languages](https://hosted.weblate.org/widget/prettier-for-nova/language-badge.svg)](https://hosted.weblate.org/projects/prettier-for-nova/)
[![Translation Status](https://hosted.weblate.org/widget/prettier-for-nova/svg-badge.svg)](https://hosted.weblate.org/projects/prettier-for-nova/)

Help translate Prettier⁺ for Nova and make it accessible to more developers in
your language!

You can contribute translations directly via [Weblate](https://hosted.weblate.org/projects/prettier-for-nova/).

No coding experience required — just a GitHub or Weblate account and a few
minutes of your time.

All contributions are greatly appreciated!

## Acknowledgments

This extension builds upon the outstanding work of [Alexander Weiss](https://github.com/alexanderweiss),
who created the original [Nova Prettier Extension](https://github.com/alexanderweiss/nova-prettier).
Without his efforts, this project would not have been possible.
