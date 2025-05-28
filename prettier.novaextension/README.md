# Prettier⁺ for Nova

The Swiss Army knife for code formatting — seamlessly format JavaScript, TypeScript,
JSON, CSS, HTML, Markdown, and more in Nova, with built-in support for Astro, EJS,
Java, Laravel Blade, Liquid, PHP, SQL, Tailwind CSS, TOML, Twig, and XML
— no extra setup required.

> ⚠️ **Prettier⁺** is a drop-in replacement for the original [Prettier Extension](https://extensions.panic.com/extensions/alexanderweiss/alexanderweiss.prettier/).
> To avoid conflicts, make sure to disable the original before installing or activating Prettier⁺.

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
- **Advanced Syntax Detection:** Reliably detects the correct syntax based on file extension —
  even when Nova misidentifies it. Blade, Java, SQL, and more are correctly handled
  out of the box.
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
  `Astro`,
  `EJS`,
  `Java`,
  `Laravel Blade`,
  `Liquid`,
  `PHP`,
  `SQL`,
  `Tailwind CSS`,
  `TOML`,
  `Twig`, and
  `XML`.

- **Configuration Support:** Compatible with [standard Prettier configuration](https://prettier.io/docs/configuration),
  and [.prettierignore](https://prettier.io/docs/ignore) files.
- **Plugin Usage:** Utilizes Prettier and any plugins installed in your project,
  or defaults to the bundled Prettier and plugins if none are installed.

## Bundled Plugins

| Plugin                                                                                                     | Status      | Notes                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| [@prettier/plugin-php](https://github.com/prettier/plugin-php)                                             | ✅ Enabled  | –                                                                                                                 |
| [@prettier/plugin-xml](https://github.com/prettier/plugin-xml)                                             | ✅ Enabled  | –                                                                                                                 |
| [prettier-plugin-astro](https://github.com/withastro/prettier-plugin-astro)                                | ✅ Enabled  | ⚠️ Recommended: [Astro](https://extensions.panic.com/extensions/com.johnlindop/com.johnlindop.nova-astro/)        |
| [prettier-plugin-blade](https://github.com/shufo/prettier-plugin-blade)                                    | ✅ Enabled  | ⚠️ Recommended: [Laravel Suite](https://extensions.panic.com/extensions/emran-mr/emran-mr.laravel/)               |
| [prettier-plugin-ejs](https://github.com/ecmel/prettier-plugin-ejs)                                        | ✅ Enabled  | –                                                                                                                 |
| [prettier-plugin-ejs-tailwindcss](https://github.com/janghye0k/prettier-plugin-ejs-tailwindcss)            | ✅ Enabled  | ⚠️ Requires: `prettier-plugin-tailwindcss`                                                                        |
| [prettier-plugin-java](https://www.jhipster.tech/prettier-java/)                                           | ✅ Enabled  | ⚠️ Recommended: [Java Language Definition](https://extensions.panic.com/extensions/me.frmr/me.frmr.JavaLanguage/) |
| [prettier-plugin-liquid](https://github.com/Shopify/theme-tools/tree/main/packages/prettier-plugin-liquid) | ✅ Enabled  | ⚠️ Recommended: [Liquid](https://extensions.panic.com/extensions/me.arthr/me.arthr.Liquid/)                       |
| [prettier-plugin-nginx](https://github.com/jxddk/prettier-plugin-nginx)                                    | ✅ Enabled  | ⚠️ Recommended: [NGINX for Nova](https://extensions.panic.com/extensions/joncoole/joncoole.nginx)                 |
| [prettier-plugin-properties](https://github.com/eemeli/prettier-plugin-properties)                         | ✅ Enabled  | ⚠️ Recommended: [Java Language Definition](https://extensions.panic.com/extensions/me.frmr/me.frmr.JavaLanguage/) |
| [prettier-plugin-sql](https://github.com/un-ts/prettier/tree/master/packages/sql)                          | ✅ Enabled  | ⚠️ Recommended: [SQL](https://extensions.panic.com/extensions/stonerl/stonerl.sql/)                               |
| [prettier-plugin-tailwindcss](https://github.com/tailwindlabs/prettier-plugin-tailwindcss)                 | ➕ Optional | ⚠️ Recommended: [Tailwind CSS](https://extensions.panic.com/extensions/jasonplatts/jasonplatts.tailwindcss/)      |
| [prettier-plugin-toml](https://github.com/un-ts/prettier/tree/master/packages/toml)                        | ✅ Enabled  | ⚠️ Recommended: [TOML](https://extensions.panic.com/extensions/com.neelyadav/com.neelyadav.toml/)                 |
| [prettier-plugin-twig](https://github.com/zackad/prettier-plugin-twig)                                     | ✅ Enabled  | ⚠️ Recommended: [Twig](https://extensions.panic.com/extensions/tpmatthes/tpmatthes.Twig/)                         |

### Plugin Legend

- ✅ **Enabled by Default** — All plugins are active out of the box.

- ➕ **Tailwind (Optional)** — Tailwind CSS support is included but disabled by default. Enable it via the extension or project settings.

- ⚠️ **Extension Recommended** — These plugins work best when the corresponding Nova syntax extension is installed.

If you want to see other plugins being integrated, head over to the [Discussions](https://github.com/stonerl/nova-prettier-extension/discussions).

## Permissions

### Launch Subprocesses

- To install the bundled Prettier and its plugins.
- To launch the Prettier Service for code formatting.

### Read Files

- To read Prettier configuration files, such as `.prettierrc` and `.prettierignore`.

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
