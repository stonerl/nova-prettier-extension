## 3.5.16 - 2025-04-13

### Added

- New Command: **Format Document (Forced)** — formats the current file even if its
  syntax is ignored or excluded via `.prettierignore`.

### Changed

- Dismissing the warning shown when using _Format Selection_ on unsupported syntaxes
  now disables the command for those syntaxes.
- Refined user-facing notifications for unsupported syntaxes and reset actions
- Internal: Refactored plugin and Prettier options handling

## 3.5.15 - 2025-04-12

### Added

- **Automatic package and patch management**

  - Implemented a module resolver to validate all dependencies declared in `package.json`
  - Automatically runs `npm install` for any missing or outdated packages
  - Applies patches using `patch-package` after every install
  - Ensures patches are reapplied even when no packages are updated

- **Syntax restriction for "Format Selection"**
  - Limited "Format Selection" to syntaxes supported by Prettier’s `formatWithCursor`:
    JavaScript, TypeScript, GraphQL, and Handlebars
  - This restriction is due to upstream limitations in Prettier's cursor handling logic
  - Displays a dismissible warning when attempting to format unsupported syntaxes
  - Added command: **Reset Syntax Warnings for Prettier+** to restore suppressed messages

### Fixed

- **Prevent crash in `locStart` / `locEnd`**
  - Added null-safe checks and fallback handling to avoid crashes when a node lacks location data
  - This issue occurred in the XML plugin and previously prevented XML files from being formatted
  - Prevents `formatWithCursor` from throwing TypeErrors on malformed AST nodes

## 3.5.14 - 2025-04-09

> Note: This version supersedes 3.5.13, which was briefly published and then withdrawn due to a forgotten code update.

### Changed

- Switched to Prettier’s native `formatWithCursor` for cursor preservation during formatting.
- Removed the custom diff-based cursor logic and `fast-diff` dependency.
- Cursor handling is now handled by Prettier directly, making the code simpler and more reliable.
- Editor now automatically scrolls to the restored cursor position after formatting.

### Performance

- Formatting is now **dramatically faster**.
- A 49,395-character JSON file that previously took **30 seconds** to format now completes in just **20 milliseconds**.

## 3.5.12 - 2025-04-09

### Fixed

- Corrected option handling for `node-sql-parser`: the extension previously used the wrong configuration key,
  which caused it to parse options for `sql-formatter` instead.

## 3.5.11 - 2025-04-08

### Added

- Full German translation of the UI

### Changed

- Removed the config key `prettier.plugins.prettier-plugin-php.singleQuote`
  (it duplicated `prettier.default-config.singleQuote`)
- Cleaned up descriptions for several options
- Database language names now follow official spelling

All UI elements have been translated into German. If you spot anything awkward or off,
head over to [Weblate](https://hosted.weblate.org/projects/prettier-for-nova/) and suggest improvements.

Chinese, French, and Japanese translations still need contributors — feel free to jump in! 😄

## 3.5.10 - 2025-04-06

### Added

- Added support for formatting Java and `.properties` files
- Included `prettier-plugin-java` for Java source formatting
- Included `prettier-plugin-properties` for Java-style `.properties` configuration files

See the README for usage details.

## 3.5.9 - 2025-04-05

### Changed

- `workspaceConfig` keys now use boolean values instead of enums:
  - `Enable` → `true`
  - `Disable` → `false`
  - `Global Default` → key removed to fall back to global settings
- Compatibility with the original enum-based behavior is preserved
- Extension permission for filesystem access has been updated from `readonly` to `readwrite` to enable migration of project configuration files

### Added

- Existing project configs (`.nova/Configuration.json`) are now automatically migrated to the new boolean format on startup
- A notification is shown if any project config values were changed during migration

## 3.5.8 - 2025-04-03

### Changed

- Updated README and LICENSE

## 3.5.7 - 2025-04-02

### Changed

- Restores the internal enum keys (`Enable`, `Disable`, `Global Default`) while keeping the original
  workspace config UI label values (`Enabled`, `Disabled`, `Global Setting`).
  This ensures compatibility with the original extension, allowing Prettier+ to be used as a drop-in replacement.
  _Note: If you previously used custom values in your workspace config, you may need to update them manually._

## 3.5.6 - 2025-04-02

### Added

- activationEvents: Prettier+ now uses conditional activation. It won’t run
  unless it finds a supported config file (like `.prettierrc`) in the project
  root.
- Localization groundwork: Initial translation support has been implemented.
  Translations can be contributed via [Weblate](https://hosted.weblate.org/projects/prettier-for-nova/)

### Fixed

- Plugin option mapping: NGINX and SQL plugin options (specifically for node-sql-parser)
  were being mishandled—this has now been corrected.

## 3.5.5 - 2025-04-01

### Added

- added new Prettier option: `objectWrap`

### Changed

- build: generate config from unified source

## 3.5.4 - 2025-04-01

### Fixed

- Fix incorrect switch cases in getWorkspaceConfig()

### Added

- Added Acknowledgments to README.md

## 3.5.3 - 2025-03-31

### Changed

- Updated versioning scheme to reflect new format
- Changed repository and issues URLs

## 3.1.1 - 2025-03-31

This extension has been forked from the [original extension](https://extensions.panic.com/extensions/alexanderweiss/alexanderweiss.prettier/).

### Changed

- updated bundled Prettier module to 3.4.1
- updated bundled node modules to their latest version
- all Global Settings are now available in the Project settings
  (including ignored Syntax)
- renamed Global Default to Global Setting
- renamed Enable/Disable to Enabled/Disabled
- add placeholder values
- ENUMS are displayed as drop-downs instead of radio buttons
- all Titles are now in Title Case
- updated the links for Prettier Options
- updated descriptions
- added named exports to rollup
- JS files are now minified during extension build
- log Prettier options to the console
- don't log do extension console by default
- bundled plugins are loaded dynamically
- set proper extension category: commands, formatter & keybindings

### Added

- `@rollup/plugin-terser` to minify the extensions JS
- Prettier option `singleAttributePerLine`
- Prettier option `embeddedLanguageFormatting`
- `@prettier/plugin-xml` for formatting XML files
- added `prettier-plugin-sql` for formatting SQL files
- plugins can be configured in the extension/project setting
- bundled plugins can be enabled/disabled individually
- added SQL and XML to the ignored syntax

### Fixed

- PHP Plugin was bundled but never used

### Deprecated

- JSX Brackets (will be removed in a future version)

### Known Issues

When adding params or paramsType to the sql-formatter option, the user must
click outside the text filed for the changes to be applied. Will be fixed in a
future release.

## 2.6.0 - 2023-05-01

### Added

- Try formatting based on the syntax selected in Nova
  if Prettier can't determine the parser
- Add support for formatting unsaved TSX and HTML (ERB) files

## 2.5.1 - 2023-04-17

### Fixed

- Fixes extension crashing when opening a file outside a workspace, or a remote file

## 2.5.0 - 2023-04-16

### Added

- Added support for finding Prettier installed through yarn and pnpm, etc.
  (only if `node_modules` is used)
- Look for Prettier installations in the project's parent folder before falling
  back to the bundled Prettier

### Fixed

- Fixes prettier not being able to find plugins installed in the project folder

## 2.4.0 - 2023-04-10

### Added

- Changes to Prettier configuration in `.prettierrc` and `package.json` are now
  applied automatically

### Changed

- Updated bundled Prettier to 2.8.7
- Updated bundled Prettier PHP plugin to 0.19.4

### Fixed

- Fixes `Format with Prettier` following format on save
  `Ignore documents without Prettier configuration file` configuration value
- Fixes a possible error when restarting the Prettier process

## 2.3.0 - 2021-05-19

### Added

- Added global and project settings to override the Prettier module path
- Added (experimental) support for `prettier-eslint`

### Changed

- Errors occurring while loading the Prettier module will now be logged with
  message and stack trace

## 2.2.2 - 2021-05-10

### Changed

- Revert to keeping cursor position in the extension

## 2.2.1 - 2021-02-21

### Changed

- Use Nova's new built-in way of keeping the cursor position/selection after formatting

## 2.2.0 - 2021-02-04

### Added

- Added `Save Without Formatting` command

### Changed

- Loading Prettier may be retried once after a small delay instead of immediately
  showing an error
- Updated bundled Prettier to 2.2.1
- Updated bundled Prettier PHP plugin to 0.16.1

## 2.1.0 - 2020-11-25

### Changed

- Updated bundled Prettier PHP plugin to 0.16.0
- Updated bundled Prettier to 2.2.0

### Fixed

- Fixes project Prettier not getting found when using npm v7.0.0

## 2.0.0 - 2020-11-03

### Added

- Added `Format selection` command
- All selections/cursors are now maintained after formatting
- A warning is now shown if a document uses an unsupported syntax when
  formatting manually

### Changed

- **(Breaking)** Removed compatibility mode
- Renamed `Format with Prettier` to `Format` and moved it into a submenu
- Nova will now wait for formatting before saving instead of saving twice
- Formatting a file while the extension is installing Prettier will be delayed
  instead of getting ignored entirely
- Disabling debug logging now also disables logging about finding Prettier

### Fixed

- Fixes project Prettier not getting found in some cases

## 1.8.2 - 2020-10-26

### Fixed

- Fixes last line of code getting duplicated in some cases
- Fixes position of column indicator offset by -1
- Fixes a possible error when trying to check Prettier version
- Fixes (PHP) syntax errors without a column indicator causing an error
- Fixes (Twig) syntax errors with a double column indicator causing an error

## 1.8.1 - 2020-10-23

### Added

- Support syntax errors thrown by `prettier-plugin-twig-melody`

## 1.8.0 - 2020-10-18

### Added

- Added preferences to set default Prettier configuration globally and per-project.
- Added preference (global and per-project) to ignore files for which no Prettier
  configuration file can be found when formatting on save.
- Added preference (global and per-project) to ignore remote files when
  formatting on save.
- Added preference to disable debug logging (errors are always logged).

### Changed

- Added an extra warning about future compatibility mode removal

### Fixed

- Fixes extension failing to parse NPM output and failing to start when no
  project Prettier is installed.

## 1.7.1- 2020-10-09

### Fixed

- Actually fixes parser overrides in `.prettierrc` file getting ignored.

## 1.7.0 - 2020-10-08

### Changed

- Only use Prettier available in the project if it's a direct project dependency.
- Take `.editorconfig` into account when determining formatting configuration.
- The `Format with Prettier` command now ignores the `.prettierignore` file.

### Fixed

- Fixes parser overrides in `.prettierrc` file getting ignored.
- Fixes formatting an unsaved file outside of a workspace causing an error.
- Fixes document text getting mixed up if changes are made during formatting.

## 1.6.1 - 2020-10-05

### Added

- Added global setting to disable `Format on save` for specific syntaxes.
- Included PHP plugin with bundled Prettier.
- More events are logged to the extension console.

### Changed

- Plugin support is now enabled by default, but can be disabled when errors occur.
- Selected text now remains selected after formatting
  (doesn't support multiple selections / cursors).
- Folded code will now remain folded unless formatting changes it.
- Improved formatting speed.
- The `Format with Prettier` command is now available for all syntaxes,
  so it works with plugins.
- Show syntax errors from PHP plugin inline.
- Don't show error when trying to format a file that has no parser available.

### Fixed

- Fixes an error trying to log errors occurring while looking up configuration.

## 1.5.2 - 2020-10-03

### Changed

- Show notification about any unhandled errors during formatting.

### Fixed

- Fixes syntax errors preventing formatting no longer getting reported.
- Fixes issues on older macOS releases.

## 1.5.1 - 2020-09-27

### Changed

- When formatting on save, automatically save the file again if Nova thought
  formatting took too long and saved the unformatted version.

### Fixed

- Fixes unnecessary document updates when it's already properly formatted.

## 1.5.0 - 2020-09-26

### Added

- Support for Prettier plugins
  (requires enabling `Run Prettier in a separate process (experimental)`).

### Changed

- Improved performance when formatting large files
  (requires enabling `Run Prettier in a separate process (experimental)`).
- Stop formatting PHP, unless the PHP plugin is used.

## 1.4.0 - 2020-09-25

### Added

- Set a default keyboard shortcut for `Format with Prettier` command: ⌥⇧F.
- Added a global `Format on save` preference that can be overridden by project preferences.
- Support formatting of HTML in PHP files.

### Changed

- Fall back to bundled Prettier when loading the project's
  Prettier installation fails.

### Fixed

- Fixes files opened after disabling formatting on save getting formatted on save.

## 1.3.0 - 2020-09-21

### Added

- Support formatting of files in non-project windows.
- Support working on the Prettier repository.
- Automatically update the bundled installation of Prettier
  if the extension includes a new version.

### Changed

- **(Breaking)** Updated bundled Prettier to 2.1.2.

## 1.2.1 - 2020-09-17

### Added

- Support formatting of new files that have never been saved.
- Include CSS in supported syntaxes.

### Changed

- Don't require editor focus for the `Format with Prettier` to be available.
- Log non-syntax errors from Prettier to the extension console properly.
- Include stack trace with errors logged in the extension console.

## 1.2.0 - 2020-08-17

### Added

- Added a warning with help when Prettier (and NPM) can't be found.

## 1.1.0 - 2020-06-15

### Added

- Use Prettier installed in the project's node_modules. If none is available the
  extension falls back to the bundled Prettier.
- Automatically find and load parsers provided by Prettier.

## 1.0.0 - 2020-06-12

### Added

- Use .`prettierignore` to determine which files to format
  (`.prettierignore` needs to be in the project root).
- Added a warning when an error occurs while looking up
  the Prettier configuration for a file.

### Changed

- **(Breaking)** Updated to Prettier 2.0.5.

## 0.2.0 - 2020-02-29

### Added

- Don't include prettier in extension, but install when activating.

## 0.1.0 - 2020-01-31

### Added

- Initial release.
