/**
 * scramble-testfiles.js — Deliberately mangles formatting in format samples
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Applies language-specific formatting mistakes to the sample files in
 * tests/format-samples/ to simulate real-world input for the manual
 * verify loop: scramble → open in Nova → format → eyeball the result.
 *
 * - Dispatch is suffix-aware: the longest matching suffix wins, so
 *   `blade.sample.blade.php` maps to the Blade injector while a plain
 *   `.php` file maps to the PHP one.
 * - Every injector is deterministic: a seeded PRNG (mulberry32) replaces
 *   Math.random, seeded per file from its filename. Running the script
 *   twice on the same tree produces byte-identical scrambles.
 * - Injectors only mangle; none of the rules "improve" formatting.
 *
 * Usage:
 *   node scripts/scramble-testfiles.js            scramble in place
 *   node scripts/scramble-testfiles.js --dry      show what would run
 *   node scripts/scramble-testfiles.js --seed=7   override the base seed
 */

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const seedArg = args.find((arg) => arg.startsWith('--seed='))
const baseSeed = seedArg ? Number(seedArg.split('=')[1]) || 0 : 0x5eed
const dirArg = args.find((arg) => arg.startsWith('--dir='))
const SAMPLES_DIR = dirArg
  ? path.resolve(dirArg.split('=').slice(1).join('='))
  : path.join(__dirname, '..', 'tests', 'format-samples')

function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fnv1a(str) {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Seeded, per-file RNG: same filename → same sequence of decisions. */
function rngFor(file) {
  return mulberry32(baseSeed ^ fnv1a(file))
}

function jitterIndent(rng, line, indentUnit) {
  const leading = line.match(/^[ \t]*/)[0]
  const body = line.slice(leading.length)
  if (!body) return line

  const levels = leading.length
    ? Math.round(leading.length / indentUnit.length)
    : 0
  const roll = rng()
  if (levels > 0 && roll < 0.45) {
    return body
  }
  if (roll < 0.7) {
    return indentUnit.repeat(levels) + body
  }
  return indentUnit.repeat(levels + 1) + body
}

// suffix dispatch table (longest match wins)

const injectors = {
  '.blade.php': simulateBladeMistakes,
  '.html.ejs': simulateEjsMistakes,
  '.astro': simulateAstroMistakes,
  '.blade': simulateBladeMistakes,
  '.twig': simulateTwigMistakes,
  '.toml': simulateTomlMistakes,
  '.dockerfile': simulateDockerfileMistakes,
  '.containerfile': simulateDockerfileMistakes,
  '.nginx': simulateNginxMistakes,
  '.properties': simulatePropertiesMistakes,
  '.graphql': simulateGraphqlMistakes,
  '.ejs': simulateEjsMistakes,
  '.html': simulateHtmlMistakes,
  '.md': simulateMarkdownMistakes,
  '.php': simulatePhpMistakes,
  '.java': simulateJavaMistakes,
  '.js': simulateJsMistakes,
  '.jsx': simulateJsMistakes,
  '.ts': simulateTsMistakes,
  '.css': simulateCssMistakes,
  '.scss': simulateScssMistakes,
  '.less': simulateLessMistakes,
  '.vue': simulateVueMistakes,
  '.xml': simulateXmlMistakes,
  '.yaml': simulateYamlMistakes,
  '.yml': simulateYamlMistakes,
  '.sql': simulateSqlMistakes,
  '.sh': simulateShMistakes,
  '.json': simulateJsonMistakes,

  '.go.html': simulateGoTemplateMistakes,
  '.html.tpl': simulateGoTemplateMistakes,
  '.html.tmpl': simulateGoTemplateMistakes,
  '.go.tmpl': simulateGoTemplateMistakes,
  '.gohtml': simulateGoTemplateMistakes,
  '.gotmpl': simulateGoTemplateMistakes,
  '.tmpl': simulateGoTemplateMistakes,
  '.tpl': simulateSmartyMistakes,
  '.njk': simulateTwigMistakes,
  '.nunjucks': simulateTwigMistakes,
  '.nunj': simulateTwigMistakes,
  '.hugo': simulateMarkdownMistakes,
}

const suffixes = Object.keys(injectors).sort((a, b) => b.length - a.length)

function findSuffix(file) {
  const lower = file.toLowerCase()
  return suffixes.find((suffix) => lower.endsWith(suffix))
}

fs.readdirSync(SAMPLES_DIR).forEach((file) => {
  const fullPath = path.join(SAMPLES_DIR, file)
  if (!fs.statSync(fullPath).isFile()) return

  const suffix = findSuffix(file)
  const injector = suffix ? injectors[suffix] : null

  if (!injector) {
    console.warn(`Skipping unsupported file: ${file}`)
    return
  }

  if (dryRun) {
    console.log(`Would scramble: ${file} (${suffix})`)
    return
  }

  const original = fs.readFileSync(fullPath, 'utf-8')
  const scrambled = injector(original, rngFor(file))
  fs.writeFileSync(fullPath, scrambled, 'utf-8')
  console.log(`Scrambled: ${file} (${suffix})`)
})

// === FORMATTER FUNCTIONS ===
// Every function receives (content, rng) and returns the mangled text;
// rng replaces Math.random for determinism.

function simulateCssMistakes(content, _rng) {
  const lines = content.split('\n')
  let inBlockComment = false

  return lines
    .map((line) => {
      const trimmed = line.trim()

      if (trimmed.startsWith('/*')) inBlockComment = true
      if (inBlockComment) {
        if (trimmed.endsWith('*/')) inBlockComment = false
        return line
      }

      if (trimmed.startsWith('//') || trimmed === '') return line

      return line
        .replace(/^\s+/g, '')
        .replace(/\s*{\s*/g, '{ ')
        .replace(/\s*}\s*/g, '} ')
        .replace(/\s*:\s*/g, ':')
        .replace(/\s*;\s*/g, ';')
        .replace(/\s+/g, ' ')
    })
    .join('\n')
}

function simulateEjsMistakes(content, _rng) {
  const lines = content.split('\n')
  const result = []
  let indentLevel = 0

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    if (trimmed === '') {
      result.push('')
      continue
    }

    const isLogicLine = /^<%[^=]/.test(trimmed)
    const isOutputLine = /^<%=/.test(trimmed)

    if (trimmed.startsWith('<% }') || trimmed === '<% } %>') {
      indentLevel = Math.max(0, indentLevel - 1)
    }

    if (isLogicLine || isOutputLine) {
      const spaced = trimmed
        .replace(/\s{2,}/g, ' ')
        .replace(/^\s+/, '')
        .replace(/%>\s*$/, '%>')
        .replace(/<%\s*/g, '<% ')
        .replace(/\s*%>/g, ' %>')

      result.push('  '.repeat(indentLevel) + spaced)

      // opening logic block
      if (trimmed.match(/<%.*{\s*%>$/)) {
        indentLevel++
      }

      continue
    }

    result.push('  '.repeat(indentLevel) + trimmed)
  }

  return result.join('\n')
}

function simulateJsMistakes(content, _rng) {
  const lines = content.split('\n')
  const result = []

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i]
    const trimmed = currentLine.trim()

    const isComment =
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/')

    result.push(currentLine)

    const nextLineWasBlank = lines[i + 1] === ''
    if (isComment && nextLineWasBlank) {
      result.push('')
      i++ // skip next (blank) line
    }

    if (trimmed && !isComment) {
      const scrambled = currentLine.replace(/\s{2,}/g, ' ').replace(/^\s+/g, '')
      result[result.length - 1] = scrambled
    }
  }

  return result.join('\n')
}

function simulateTsMistakes(content, rng) {
  return simulateJsMistakes(content, rng)
}

function simulatePhpMistakes(content, _rng) {
  const lines = content.split('\n')
  const result = []

  let inHtml = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '?>') inHtml = true
    if (trimmed.startsWith('<?php')) inHtml = false

    if (inHtml || trimmed.startsWith('<!')) {
      result.push(line)
      continue
    }

    // don't scramble echo/return lines containing quotes
    const isSensitiveLine =
      /\b(echo|return)\b/.test(trimmed) && /["'].*["']/.test(trimmed)

    if (
      trimmed === '' ||
      trimmed.startsWith('<?') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/') ||
      trimmed.startsWith('namespace') ||
      trimmed.startsWith('use ') ||
      isSensitiveLine
    ) {
      result.push(line)
      continue
    }

    const scrambled = line
      .replace(/ {2,}/g, ' ')
      .replace(/\s*([=;:{}(),\[\]])\s*/g, '$1')
      .replace(/^\s{4}/, '  ')
      .replace(/\s+$/g, '')

    result.push(scrambled)
  }

  return result.join('\n')
}

function simulateMarkdownMistakes(content, rng) {
  let inFencedBlock = false
  let inFrontmatter = false

  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      if (trimmed === '---') {
        inFrontmatter = !inFrontmatter
        return line
      }
      if (inFrontmatter) return line

      if (trimmed.startsWith('```')) {
        inFencedBlock = !inFencedBlock
        return line
      }

      const shouldSkip =
        inFencedBlock ||
        trimmed === '' ||
        /^\s*[#>]/.test(trimmed) || // headings & blockquotes
        /^\{[%{]/.test(trimmed) || // lines starting with {% or {{
        /`[^`]+`/.test(trimmed) || // inline code
        /'[^']+'|"[^"]+"/.test(trimmed) // quoted strings (link titles etc.)

      if (shouldSkip) return line

      // template literal — don't touch
      if (/\{\{[^}]+\}\}|\{\%[^%]+\%\}/.test(line)) {
        return line
      }

      // list item — scramble only the content
      const listMatch = line.match(/^(\s*([-+*]|\d+\.)\s+)(.*)$/)
      if (listMatch) {
        const [, prefix, , text] = listMatch
        return prefix + scramble(text)
      }

      return scramble(line)

      function scramble(text) {
        return text
          .split(/(\s+)/)
          .map((chunk, i) => {
            if (i % 2 === 1) {
              const pad = Math.floor(rng() * 3) // deterministic 0–2 spaces
              return chunk + ' '.repeat(pad)
            }
            return chunk
          })
          .join('')
      }
    })
    .join('\n')
}

function simulateHtmlMistakes(content, _rng) {
  const lines = content.split('\n')
  const result = []
  let inScript = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.startsWith('<script')) inScript = true
    if (trimmed.startsWith('</script>')) inScript = false

    if (trimmed.startsWith('<!--') || trimmed === '') {
      result.push(line)
      continue
    }

    // script content: messy but line-by-line
    if (
      inScript &&
      !trimmed.startsWith('<script') &&
      !trimmed.startsWith('</script>')
    ) {
      result.push(
        line
          .replace(/ {2,}/g, ' ')
          .replace(/;\s*/g, '; ')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      continue
    }

    result.push(line.replace(/ {2,}/g, ' ').replace(/^\s+/g, ''))
  }

  return result.join('\n')
}

function simulateGraphqlMistakes(content, _rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || trimmed === '') return line
      return line.replace(/\s+/g, ' ')
    })
    .join('\n')
}

function simulateJsonMistakes(content, _rng) {
  return content
    .replace(/:\s*/g, ': ')
    .replace(/,\s*/g, ', ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

function simulateScssMistakes(content, _rng) {
  const lines = content.split('\n')
  const result = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/')
    ) {
      result.push(line)
      continue
    }

    const scrambled = line
      .replace(/^\s+/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s*([:{};,])\s*/g, '$1')
      .replace(/,\s*/g, ', ')

    result.push(scrambled)
  }

  return result.join('\n')
}

function simulateLessMistakes(content, _rng) {
  const lines = content.split('\n')
  const result = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (
      trimmed === '' ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/')
    ) {
      result.push(line)
      continue
    }

    const scrambled = line
      .replace(/^\s+/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s*([{}();])\s*/g, '$1')
      .replace(/:\s*/g, ': ')
      .replace(/,\s*/g, ', ')
      .replace(/&:\s+/g, '&:') // space changes meaning for & pseudo-selectors

    result.push(scrambled)
  }

  return result.join('\n')
}

function simulateVueMistakes(content, rng) {
  const templateMatch = content.match(
    /<template\b[^>]*>([\s\S]*?)<\/template\s*>/i,
  )
  const scriptMatch = content.match(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/i)
  const styleMatch = content.match(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/i)

  let scrambledTemplate = ''
  let scrambledScript = ''
  let scrambledStyle = ''

  if (templateMatch) {
    scrambledTemplate = templateMatch[1]
      .split('\n')
      .map((line) => {
        return line
          .replace(/:\s+(\w+)/g, ':$1')
          .replace(/@\s+(\w+)/g, '@$1')
          .replace(/"\s+(:|@)/g, '" $1')
          .replace(/\s{2,}/g, ' ')
          .replace(/^\s+/g, '')
      })
      .join('\n')
  }

  if (scriptMatch) {
    scrambledScript = scriptMatch[0]
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()
        if (trimmed === '' || trimmed.startsWith('//')) return line
        return line
          .replace(/\s{2,}/g, ' ')
          .replace(/^\s+/g, '')
          .replace(/,\s*/g, ', ')
          .replace(/:\s*/g, ': ')
          .replace(/;\s*/g, '; ')
          .replace(/{\s*/g, '{ ')
          .replace(/\s*}/g, ' }')
      })
      .join('\n')
  }

  if (styleMatch) {
    scrambledStyle = simulateScssMistakes(styleMatch[0], rng)
  }

  return [
    '<template>',
    scrambledTemplate.trim(),
    '</template>',
    '',
    scrambledScript.trim(),
    '',
    scrambledStyle.trim(),
  ].join('\n\n')
}

function simulateXmlMistakes(content, _rng) {
  const lines = content.split('\n')
  const result = []

  let inCdata = false
  let inTextBlock = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.includes('<![CDATA[')) {
      inCdata = true
      result.push(line)
      continue
    }

    if (trimmed.includes(']]>')) {
      inCdata = false
      result.push(line)
      continue
    }

    if (!inCdata && !trimmed.startsWith('<') && !trimmed.endsWith('>')) {
      inTextBlock = true
    } else {
      inTextBlock = false
    }

    if (
      inCdata ||
      inTextBlock ||
      trimmed.startsWith('<?xml') ||
      trimmed.startsWith('<!') ||
      trimmed.startsWith('<!--') ||
      trimmed.startsWith('-->') ||
      trimmed === ''
    ) {
      result.push(line)
      continue
    }

    // Scramble only tag lines — leading indentation is preserved on
    // purpose: @prettier/plugin-xml treats whitespace-only text nodes as
    // significant, so a re-indent cannot be recovered by formatting.
    const scrambled = line.replace(
      /^(\s*)([\s\S]*?)\s*$/,
      (_, indent, body) => {
        return indent + body.replace(/ {2,}/g, ' ').replace(/\s*=\s*/g, '=')
      },
    )

    result.push(scrambled)
  }

  return result.join('\n')
}

function simulateYamlMistakes(content, _rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      if (
        trimmed === '' ||
        trimmed.startsWith('#') ||
        trimmed.endsWith('|') ||
        trimmed.endsWith('>') ||
        trimmed.startsWith('<<: *') ||
        trimmed.startsWith('---') ||
        trimmed.startsWith('...')
      ) {
        return line
      }

      if (/^['"].+['"]\s*:/.test(trimmed)) {
        return line
      }

      // unquoted keys only: normalize colon spacing
      return line.replace(/\s*:\s*/g, ': ')
    })
    .join('\n')
}

function simulateSqlMistakes(content, _rng) {
  return content
    .replace(/ {2,}/g, ' ')
    .replace(/\t+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/gm, '')
}

function simulateNginxMistakes(content, _rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      if (trimmed === '' || trimmed.startsWith('#')) {
        return line
      }

      let scrambled = line

      scrambled = scrambled.replace(/^\s+/, '')
      scrambled = scrambled.replace(/\s{2,}/g, ' ')
      scrambled = scrambled.replace(/\s*;/g, ';')
      scrambled = scrambled.replace(/\s*{\s*/g, ' { ')
      scrambled = scrambled.replace(/\s*}\s*/g, ' } ')

      return scrambled
    })
    .join('\n')
}

function simulateJavaMistakes(content, rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // comments and annotations: untouched
      if (
        trimmed === '' ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('@')
      ) {
        return line
      }

      let modified = line

      // extra spaces between identifiers (not operators)
      modified = modified.replace(
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\b(?=\s+\b[a-zA-Z_][a-zA-Z0-9_]*\b)/g,
        (match) => match + (rng() < 0.5 ? '' : ' '),
      )

      // spacing after control keywords
      modified = modified.replace(
        /\b(public|private|protected|if|else|while|for|return|static|final|class)\b\s+/g,
        (match, keyword) => keyword + ' '.repeat(1 + Math.floor(rng() * 2)),
      )

      return modified
    })
    .join('\n')
}

function simulatePropertiesMistakes(content, rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // # and ! comments: untouched
      if (
        trimmed === '' ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('!')
      ) {
        return line
      }

      // continuation line: untouched
      if (line.match(/\\\s*$/)) return line

      const match = line.match(/^(\s*)([^:=]+?)(\s*)([:=])(\s*)(.*)$/)
      if (!match) return line

      const [, indent, key, , separator, , value] = match

      let newLine = indent

      // lose spacing around separators
      const roll = rng()
      if (roll < 0.3) {
        newLine += key + separator + value
      } else if (roll < 0.6) {
        newLine += key + separator + ' ' + value
      } else {
        newLine += key + ' ' + separator + '  ' + value
      }

      if (rng() < 0.1) {
        newLine = '  ' + newLine
      }

      return newLine
    })
    .join('\n')
}

// --- New injectors ---

function simulateShMistakes(content, _rng) {
  let heredocEnd = null

  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // heredoc body: leave everything alone
      if (heredocEnd !== null) {
        if (trimmed === heredocEnd) heredocEnd = null
        return line
      }

      // heredoc start: skip its body
      const heredoc = trimmed.match(/<<-?['"]?(\w+)['"]?/)
      if (heredoc) {
        heredocEnd = heredoc[1]
        return line
      }

      if (trimmed === '' || trimmed.startsWith('#')) return line

      let scrambled = jitterIndent(_rng, line, '  ')
      scrambled = scrambled.replace(/\s{2,}/g, ' ')
      // `;;` terminates `case` arms — leave it, only mess with single `;`
      scrambled = scrambled.replace(
        /(?<!;)\s*;(?!;)\s*/g,
        _rng() < 0.5 ? '; ' : ';',
      )
      scrambled = scrambled.replace(/\s*\|\s*/g, _rng() < 0.5 ? '|' : ' | ')
      scrambled = scrambled.replace(/\s*&&\s*/g, _rng() < 0.5 ? ' && ' : '&&')
      return scrambled
    })
    .join('\n')
}

function simulateDockerfileMistakes(content, rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // comments, blank lines, continuation lines: untouched
      if (trimmed === '' || trimmed.startsWith('#') || trimmed.endsWith('\\')) {
        return line
      }

      let scrambled = jitterIndent(rng, line, '  ')
      // collapse runs; occasionally lowercase the instruction keyword
      scrambled = scrambled.replace(/\s{2,}/g, ' ')
      const keyword = scrambled.match(/^([A-Z][A-Z0-9]+)\b/)
      if (keyword && rng() < 0.3) {
        scrambled =
          keyword[1].toLowerCase() + scrambled.slice(keyword[1].length)
      }
      return scrambled
    })
    .join('\n')
}

function simulateTomlMistakes(content, rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // comments, blank lines, multiline string markers: untouched
      if (
        trimmed === '' ||
        trimmed.startsWith('#') ||
        trimmed === '"""' ||
        trimmed === "'''"
      ) {
        return line
      }

      let scrambled = jitterIndent(rng, line, '  ')
      scrambled = scrambled.replace(/\s*=\s*/g, rng() < 0.5 ? ' = ' : '=')
      scrambled = scrambled.replace(/\s*,\s*/g, ', ')
      scrambled = scrambled.replace(/\s{2,}/g, ' ')
      return scrambled
    })
    .join('\n')
}

function simulateAstroMistakes(content, _rng) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  let frontmatter = ''
  let template = content

  if (frontmatterMatch) {
    frontmatter = frontmatterMatch[1]
    template = content.slice(frontmatterMatch[0].length)
  }

  // Frontmatter: strip indents, collapse spaces (TS-ish mangle)
  const mangledFrontmatter = frontmatter
    .split('\n')
    .map((line) => line.replace(/\s{2,}/g, ' ').replace(/^\s+/g, ''))
    .join('\n')

  // Template: strip leading indents, tighten attribute spacing
  const mangledTemplate = template
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed === '') return ''
      return line
        .replace(/^\s+/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/=\s+"/g, '="')
    })
    .join('\n')

  return (
    (frontmatterMatch ? `---\n${mangledFrontmatter}\n---` : '') +
    mangledTemplate
  )
}

function simulateBladeMistakes(content, rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      if (trimmed === '') return line

      // @php blocks: verbatim
      if (trimmed.startsWith('@php')) return line

      let scrambled = jitterIndent(rng, line, '  ')
      scrambled = scrambled.replace(/\s{2,}/g, ' ')
      // mangle spacing inside {{ }} and @directive expressions
      scrambled = scrambled.replace(/\{\{\s*/g, rng() < 0.5 ? '{{' : '{{ ')
      scrambled = scrambled.replace(/\s*\}\}/g, '}}')
      scrambled = scrambled.replace(/@(\w+)\s*\(/g, (m, name) =>
        rng() < 0.5 ? `@${name}(` : `@${name} (`,
      )
      return scrambled
    })
    .join('\n')
}

function simulateTwigMistakes(content, rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      if (trimmed === '') return line

      let scrambled = jitterIndent(rng, line, '  ')
      scrambled = scrambled.replace(/\s{2,}/g, ' ')
      // tag spacing: {% tag %} / {%tag%}
      scrambled = scrambled.replace(/\{%\s*/g, rng() < 0.5 ? '{%' : '{% ')
      scrambled = scrambled.replace(/\s*%\}/g, '%}')
      scrambled = scrambled.replace(/\{\{\s*/g, rng() < 0.5 ? '{{' : '{{ ')
      scrambled = scrambled.replace(/\s*\}\}/g, '}}')
      return scrambled
    })
    .join('\n')
}

function simulateGoTemplateMistakes(content, rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      if (trimmed === '') return line

      let scrambled = jitterIndent(rng, line, '  ')
      scrambled = scrambled.replace(/\s{2,}/g, ' ')
      // template spacing: {{ expr }} / {{expr}}
      scrambled = scrambled.replace(/\{\{\s*/g, rng() < 0.5 ? '{{' : '{{ ')
      scrambled = scrambled.replace(/\s*\}\}/g, '}}')
      return scrambled
    })
    .join('\n')
}

function simulateSmartyMistakes(content, rng) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      if (trimmed === '') return line

      let scrambled = jitterIndent(rng, line, '  ')
      scrambled = scrambled.replace(/\s{2,}/g, ' ')
      // tag spacing: <{ tag }> / <{tag}>
      scrambled = scrambled.replace(/<\{\s*/g, rng() < 0.5 ? '<{' : '<{ ')
      scrambled = scrambled.replace(/\s*\}>/g, '}>')
      return scrambled
    })
    .join('\n')
}
