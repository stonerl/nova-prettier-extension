# Prettier+ for Nova

Experience seamless code formatting with Prettier directly in Nova.

- **Format on save:** Automatically format your code on save
  (this setting can be customized per project), or manually format using
  `Editor > Prettier+ > Format Document` (**⌥⇧F**).
- **Language Support:** Supports all Prettier-supported languages, including
  `Angular`,
  `CSS`,
  `Flow`,
  `GraphQL`,
  `HTML`,
  `Java`,
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
  `PHP`,
  `SQL`, and
  `XML`.

- **Configuration Support:** Compatible with [standard Prettier configuration](https://prettier.io/docs/configuration),
  and [.prettierignore](https://prettier.io/docs/ignore) files.
- **Plugin Usage:** Utilizes Prettier and any plugins installed in your project,
  or defaults to the built-in Prettier and plugins if none are installed.

This extension can be used as a drop-in replacement for the original [Prettier Extension](https://extensions.panic.com/extensions/alexanderweiss/alexanderweiss.prettier/).
You can freely switch between both; just make sure that you only have one enabled at a time.

## Bundled plugins

- ✅ **[@prettier/plugin-php](https://github.com/prettier/plugin-php)**
- ✅ **[@prettier/plugin-xml](https://github.com/prettier/plugin-xml)**
- ✅ **[prettier-plugin-sql](https://github.com/un-ts/prettier/tree/master/packages/sql)**
- ⚠️ **[prettier-plugin-java](https://www.jhipster.tech/prettier-java/)**
- ⚠️ **[prettier-plugin-properties](https://github.com/eemeli/prettier-plugin-properties)**
- ⚠️ **[prettier-plugin-nginx](https://github.com/jxddk/prettier-plugin-nginx)**

✅ Enabled by default

⚠️ **Note:** Before enabling any of the following plugins, make sure the corresponding Nova language extensions are installed:

- `prettier-plugin-java` and `prettier-plugin-properties`
  ➤ Requires the [Java Language Definition](https://extensions.panic.com/extensions/me.frmr/me.frmr.JavaLanguage/) extension

- `prettier-plugin-nginx`
  ➤ Requires the [NGINX for Nova](https://extensions.panic.com/extensions/joncoole/joncoole.nginx) extension

## Using external plugins in your project

To use external Prettier plugins, simply install them along with Prettier in
your project.

## Ignoring files

You can disable `Format on Save` for remote documents, documents without a Prettier
configuration file, or specific syntaxes in the extension and project preferences.
Additionally you can use Prettier's [built-in exclusion](https://prettier.io/docs/ignore#ignoring-files-prettierignore)
feature by adding a `.prettierignore` file to the root of your project.

_Note: adding it anywhere else won't work._

## Using a different version of Prettier

Simply install the desired version of Prettier (2.0 or higher, although the latest
version is always recommended) in the root folder of your project. If you already
have the project open in Nova, you'll need to reopen it after installing or updating
Prettier for the extension to recognize and start using the new version.

You can also explicitly select an installation of Prettier
(or [`prettier-eslint`](https://github.com/prettier/prettier-eslint))
by setting the `Prettier module` path in the extension or project settings.

## Using Prettier forks or prettier-eslint

You can use any Prettier fork that adheres to the same API,
as well as [`prettier-eslint`](https://github.com/prettier/prettier-eslint),
by explicitly specifying the `Prettier module` path in the extension or project settings.

## Working with remote files

Most features are supported for remote files; however,
[Prettier configuration](https://prettier.io/docs/en/configuration.html) and
[.prettierignore](https://prettier.io/docs/en/ignore.html) files are not.
The default configuration set in the extension or project preferences will be
used instead.

## Versioning

Prettier+ for Nova follows [Semantic Versioning](https://semver.org/),
aligned with official Prettier releases. Versions are formatted as `a.b.c`, where:

- `a.b` corresponds to the bundled Prettier version.
- `c` is the extension’s specific build number
  (used for fixes or enhancements unrelated to the Prettier core).

For example, `3.5.4` uses Prettier `v3.5.x` and is the fourth extension build.

## Contributing Translations

[![Languages](https://hosted.weblate.org/widget/prettier-for-nova/language-badge.svg)](https://hosted.weblate.org/projects/prettier-for-nova/)
[![Translation Status](https://hosted.weblate.org/widget/prettier-for-nova/svg-badge.svg)](https://hosted.weblate.org/projects/prettier-for-nova/)

Help translate Prettier+ for Nova and make it accessible to more developers in
your language!

You can contribute translations directly via [Weblate](https://hosted.weblate.org/projects/prettier-for-nova/).

No coding experience required — just a GitHub or Weblate account and a few
minutes of your time.

All contributions are greatly appreciated!

## Acknowledgments

This extension builds upon the outstanding work of [Alexander Weiss](https://github.com/alexanderweiss),
who created the original [Nova Prettier Extension](https://github.com/alexanderweiss/nova-prettier).
Without his efforts, this project would not have been possible.
