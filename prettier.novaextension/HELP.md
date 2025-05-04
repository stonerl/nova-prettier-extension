## Table of Contents

- General
  - Prettier Module Resolution
  - Override Behavior Precedence
  - Settings Precedence
- Configuration
  - Configuration Methods
  - Configuration Precedence
- Ignoring Files
- Working with Remote Files
- Troubleshooting
  - Formatting not Working
  - Resetting the Extension
  - Custom Prettier Forks
  - Prettier-Eslint (Not Supported)

## General

Prettier⁺ includes a **built-in version of Prettier** with support for common
plugins like `prettier-plugin-php`, `prettier-plugin-xml`, `prettier-plugin-sql`,
and more.

This bundled version is the **default** and recommended way to use Prettier⁺.

### Prettier Module Resolution

However, Prettier⁺ will automatically prefer another version if found:

1. **Global Prettier**

   If you've set `General → Prettier Module` to a global install in the
   `Extension Settings` or `Project Settings`, the globally installed Prettier
   will be used.

   To install globally:

   ```bash
   npm install -g prettier
   ```

2. **Project-local Prettier**

   If your project contains a `prettier` installation in `node_modules`, it will
   be used automatically.

### Override Behavior Precedence

1.  **Global Prettier**

    If the `General → Prettier Module` path is set, the globally installed Prettier is used.

2.  **Project‑local Prettier**

    Otherwise, if a `prettier` installation is found in your project’s `node_modules`,
    that version is used.

3.  **Bundled Prettier (Preferred)**

    If neither a global path nor a project‑local install is detected — or if you enable
    `General → Prefer Bundled Prettier` under _Extension Settings_ or _Project Settings_
    — the built‑in Prettier⁺ version is used.

    > Enabling `Prefer Bundled Prettier` does **not** override a global path setting.

### Settings Precedence

In general, settings changed in _Project Settings_ will override their counterpart
in the _Extension Settings_.

## Configuration

Prettier⁺ can be configured either via the UI or with any of Prettier’s standard config files.

Supported formats include:

- `.prettierrc`, `.prettierrc.json`, `.prettierrc.yml`, `.prettierrc.js`
- `prettier.config.js`, `prettier.config.cjs`
- `package.json` (`"prettier"` field)

  > All known Prettier config extensions are supported — including
  > `.json5`, `.toml`, `.ts`, `.cjs`, `.mjs`, `.cts`, and `.mts`.

### Configuration Methods

You can configure Prettier⁺ in three ways:

- **Using a custom config file**

  Set the path in either _Project Settings_ or _Extension Settings_ under
  `General → Prettier Configuration`.

- **Per-project configuration**

  Searches recursively, so configs in subfolders (e.g., monorepos) are detected.
  Prettier⁺ will look for supported config files in the project.

- **Extension or project settings**

  Options set in the Nova UI will be used if no config files are found.

### Configuration Precedence

1. If a **custom configuration file** is set, it always takes precedence — even
   if other config files exist.
2. If no global config is set, Prettier⁺ uses the
   **nearest project-local configuration file**.
3. If no config files are found, the extension falls back to the
   **options set in Nova’s Extension or Project settings**.

> If `Ignore Configuration Files` is enabled under:
> `General → Ignore Configuration Files` settings, Prettier⁺ will
> **always use the Nova UI options** — unless a custom config
> file is set, which still takes priority.

## Ignoring Files

Prettier⁺ respects `.prettierignore` files and ignored syntaxes.
You can also disable formatting for a specific file by adding a comment:

```js
// prettier-ignore
```

You can also disable **Format on Save** for:

- Remote documents
- Files without a detected configuration file
- Specific syntaxes

via the “Ignore” toggles in the _Extension_ or _Project Settings_.

## Working with Remote Files

Prettier⁺ fully supports formatting remote files by default when using Nova's
built-in remote editing.

However, **remote files do not support local configuration discovery**, including:

- `.prettierrc`, `prettier.config.js`, or other config files
- `.prettierignore` files

As a result, Prettier⁺ will use its default settings, made in the _Extensions Settings_,
when formatting remote files, and all files are included regardless of ignore
rules in `.prettierignore`.

> ⚠️ Remote formatting works, but no config or ignore files are applied.

## Troubleshooting

### Formatting not Working

- Ensure the file type is supported and not ignored.
- Enable logging and check the **Extension Console** for any errors reported by Prettier⁺.
- Try restarting the **Prettier Service** from the menu:
  `Extensions → Prettier⁺ → Restart Prettier Service`
- Try using your project’s own Prettier version or reloading the workspace.
- **Reset the extension** if dependencies appear broken.

### Resetting the Extension

To reinstall the bundled Prettier version (e.g. if auto-installation failed or
dependencies are broken):

1. Open Nova’s built-in Terminal: **Extensions → Local Terminal**.
2. Run the following commands:

   ```bash
   cd "~/Library/Application Support/Nova/Extensions/stonerl.prettier"
   rm -rf node_modules
   npm install
   ```

### Custom Prettier Forks

       Prettier⁺ supports using forked versions of Prettier as long as they export a
       compatible API (e.g. `format`, `resolveConfig`, `getFileInfo`).

       > ⚠️ Use at your own risk — compatibility with nonstandard Prettier builds may vary.

### Prettier-Eslint (Not Supported)

       Prettier⁺ does not support `prettier-eslint` or similar wrappers.

       If you rely on ESLint formatting rules, configure ESLint separately and run it
       using a dedicated formatter (e.g., via a Nova ESLint extension or your CI setup).

       Prettier⁺ focuses solely on Prettier and its plugin ecosystem.
