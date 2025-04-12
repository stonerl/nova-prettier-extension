/**
 * scramble-testfiles.js — Deliberately mangles formatting in test files
 *
 * @license MIT
 * @author Toni Förster
 * @copyright © 2025 Toni Förster
 *
 * Applies language-specific formatting mistakes to test files to simulate real-world
 * input and validate the robustness of the formatter across languages.
 */

const fs = require('fs')
const path = require('path')

const TESTS_DIR = path.join(__dirname, '..', 'tests')

const mistakeInjectors = {
  '.css': simulateCssMistakes,
  '.js': simulateJsMistakes,
  '.jsx': simulateJsMistakes,
  '.ts': simulateTsMistakes,
  '.php': simulatePhpMistakes,
  '.md': simulateMarkdownMistakes,
  '.html': simulateHtmlMistakes,
  '.graphql': simulateGraphqlMistakes,
  '.json': simulateJsonMistakes,
  '.scss': simulateScssMistakes,
  '.less': simulateLessMistakes,
  '.vue': simulateVueMistakes,
  '.xml': simulateXmlMistakes,
  '.yaml': simulateYamlMistakes,
  '.sql': simulateSqlMistakes,
  '.conf': simulateNginxMistakes,
  '.java': simulateJavaMistakes,
  '.properties': simulatePropertiesMistake,
}

fs.readdirSync(TESTS_DIR).forEach((file) => {
  const fullPath = path.join(TESTS_DIR, file)
  const ext = path.extname(file)
  const formatter = mistakeInjectors[ext]

  if (!fs.statSync(fullPath).isFile()) return
  if (!formatter) {
    console.warn(`Skipping unsupported file: ${file}`)
    return
  }

  const original = fs.readFileSync(fullPath, 'utf-8')
  const scrambled = formatter(original)
  fs.writeFileSync(fullPath, scrambled, 'utf-8')
  console.log(`Scrambled: ${file}`)
})

// === FORMATTER FUNCTIONS ===

function simulateCssMistakes(content) {
  const lines = content.split('\n')
  let inBlockComment = false

  return lines
    .map((line) => {
      const trimmed = line.trim()

      // Start or end of a block comment
      if (trimmed.startsWith('/*')) inBlockComment = true
      if (inBlockComment) {
        if (trimmed.endsWith('*/')) inBlockComment = false
        return line // Preserve as-is
      }

      // Preserve line comments or blank lines
      if (trimmed.startsWith('//') || trimmed === '') return line

      // Apply formatting mistakes
      return line
        .replace(/^\s+/g, '') // remove leading indent
        .replace(/\s*{\s*/g, '{ ')
        .replace(/\s*}\s*/g, '} ')
        .replace(/\s*:\s*/g, ':')
        .replace(/\s*;\s*/g, ';')
        .replace(/,\s*/g, ', ')
        .replace(/\s+/g, ' ')
    })
    .join('\n')
}

function simulateJsMistakes(content) {
  const lines = content.split('\n')
  const result = []

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i]
    const trimmed = currentLine.trim()

    const nextLine = lines[i + 1]?.trim()
    const isComment =
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('*/')

    // Preserve comments and their original blank-line spacing
    result.push(currentLine)

    const nextLineWasBlank = lines[i + 1] === ''
    if (isComment && nextLineWasBlank) {
      result.push('') // preserve intended blank line
      i++ // skip next (blank) line
    }

    // Format actual code lines (non-blank, non-comment)
    if (trimmed && !isComment) {
      const scrambled = currentLine.replace(/\s{2,}/g, ' ').replace(/^\s+/g, '')
      result[result.length - 1] = scrambled
    }
  }

  return result.join('\n')
}

function simulateTsMistakes(content) {
  return simulateJsMistakes(content)
}

function simulatePhpMistakes(content) {
  const lines = content.split('\n')
  const result = []

  let inHtml = false

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    const trimmed = line.trim()

    // Detect switch to HTML
    if (trimmed === '?>') inHtml = true
    if (trimmed.startsWith('<?php')) inHtml = false

    // Leave HTML untouched
    if (inHtml || trimmed.startsWith('<!')) {
      result.push(line)
      continue
    }

    // Skip scrambling for lines with echo/return + quotes
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

    // Safe formatting-only scramble
    const scrambled = line
      .replace(/ {2,}/g, ' ')
      .replace(/\s*([=;:{}(),\[\]])\s*/g, '$1')
      .replace(/^\s{4}/, '  ') // reduce indent
      .replace(/\s+$/g, '')

    result.push(scrambled)
  }

  return result.join('\n')
}

function simulateMarkdownMistakes(content) {
  const lines = content.split('\n')
  let inFencedBlock = false

  return lines
    .map((line) => {
      const trimmed = line.trim()

      // Toggle code block mode
      if (trimmed.startsWith('```')) {
        inFencedBlock = !inFencedBlock
        return line
      }

      const shouldSkip =
        trimmed === '' ||
        /^\s*(#|>)/.test(line) || // headings, blockquotes
        /`[^`]+`/.test(line) || // inline code
        (/^\s*\/\//.test(line) && inFencedBlock) // comment inside code block

      if (shouldSkip) return line

      // Line contains a template literal — don't touch
      if (/`[^`]*\$\{[^}]+\}[^`]*`/.test(line)) return line

      // List item — scramble only the content
      const listMatch = line.match(/^(\s*([-+*]|\d+\.)\s+)(.*)$/)
      if (listMatch) {
        const [, prefix, , text] = listMatch
        return prefix + scramble(text)
      }

      // Otherwise, scramble entire line
      return scramble(line)
    })
    .join('\n')

  function scramble(text) {
    return text
      .split(/(\s+)/)
      .map((chunk, i) => {
        if (i % 2 === 1) {
          return chunk + ' '.repeat(Math.floor(Math.random() * 3)) // add 0–2 spaces
        }
        return chunk
      })
      .join('')
  }
}

function simulateHtmlMistakes(content) {
  const lines = content.split('\n')
  const result = []
  let inScript = false

  for (let line of lines) {
    const trimmed = line.trim()

    // Start/end script detection
    if (trimmed.startsWith('<script')) inScript = true
    if (trimmed.startsWith('</script>')) inScript = false

    // Keep comments and blank lines exactly
    if (trimmed.startsWith('<!--') || trimmed === '') {
      result.push(line)
      continue
    }

    // Leave script content messy but line-by-line
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

    // Avoid collapsing inline tags (e.g. <input> <br> <hr> <img>)
    result.push(
      line
        .replace(/ {2,}/g, ' ')
        .replace(/^\s+/g, '') // remove leading indent
        .replace(/\s+\/>/g, ' />'), // normalize self-closing spacing
    )
  }

  return result.join('\n')
}

function simulateGraphqlMistakes(content) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('#') || trimmed === '') return line
      return line.replace(/\s+/g, ' ')
    })
    .join('\n')
}

function simulateJsonMistakes(content) {
  return content
    .replace(/:\s*/g, ': ') // fix colon spacing
    .replace(/,\s*/g, ', ') // comma spacing
    .replace(/ {2,}/g, ' ') // excess spaces
    .replace(/\n{3,}/g, '\n\n') // too many line breaks
}

function simulateScssMistakes(content) {
  const lines = content.split('\n')
  const result = []

  for (let line of lines) {
    const trimmed = line.trim()

    // Leave comments alone
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

    let scrambled = line
      .replace(/^\s+/g, '') // remove leading indent
      .replace(/\s{2,}/g, ' ') // collapse multiple spaces
      .replace(/\s*([:{}();,{}])\s*/g, '$1') // tighten syntax characters
      .replace(/#\{\s*(.*?)\s*\}/g, '#{$1}') // tighten interpolations
      .replace(/and\(/g, 'and (') // fix missing space after "and"
      .replace(/:\s*(\d+)/g, ': $1') // fix colon spacing for numbers
      .replace(/,\s*/g, ', ') // normalize comma spacing

    result.push(scrambled)
  }

  return result.join('\n')
}

function simulateLessMistakes(content) {
  const lines = content.split('\n')
  const result = []

  for (let line of lines) {
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

    let scrambled = line
      .replace(/^\s+/g, '') // remove leading indent
      .replace(/\s{2,}/g, ' ') // collapse multiple spaces
      .replace(/\s*([{}();])\s*/g, '$1') // tighten around syntax
      .replace(/:\s*/g, ': ') // normalize to one space after colon
      .replace(/,\s*/g, ', ') // comma spacing
      .replace(/#\{\s*(.*?)\s*\}/g, '#{$1}') // tighten interpolation
      .replace(/&:\s+([a-zA-Z])/g, '&:$1') // fix & pseudo selectors

    result.push(scrambled)
  }

  return result.join('\n')
}

function simulateVueMistakes(content) {
  const templateMatch = content.match(
    /<template\b[^>]*>([\s\S]*?)<\/template\s*>/i,
  )
  const scriptMatch = content.match(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/i)
  const styleMatch = content.match(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/i)

  let scrambledTemplate = ''
  let scrambledScript = ''
  let scrambledStyle = ''

  // --- TEMPLATE SCRAMBLE ---
  if (templateMatch) {
    scrambledTemplate = templateMatch[1]
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()

        return line
          .replace(/:\s+(\w+)/g, ':$1')
          .replace(/@\s+(\w+)/g, '@$1')
          .replace(/"\s+(:|@)/g, '" $1')
          .replace(/\s{2,}/g, ' ')
          .replace(/^\s+/g, '')
      })
      .join('\n')
  }

  // --- SCRIPT SCRAMBLE ---
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

  // --- STYLE SCRAMBLE ---
  if (styleMatch) {
    scrambledStyle = simulateScssMistakes(styleMatch[0])
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

function simulateXmlMistakes(content) {
  const lines = content.split('\n')
  const result = []

  let inCdata = false
  let inTextBlock = false

  for (let line of lines) {
    const trimmed = line.trim()

    if (trimmed.includes('<![CDATA[')) {
      inCdata = true
      result.push(line)
      continue
    }

    if (trimmed.includes(']]>')) {
      inCdata = false
      result.push(line) // preserve leading indentation
      continue
    }

    // Detect text-only lines
    if (!inCdata && !trimmed.startsWith('<') && !trimmed.endsWith('>')) {
      inTextBlock = true
    } else {
      inTextBlock = false
    }

    // Preserve raw content
    if (
      inCdata ||
      inTextBlock ||
      trimmed.startsWith('<?xml') ||
      trimmed.startsWith('<!--') ||
      trimmed.startsWith('-->') ||
      trimmed === ''
    ) {
      result.push(line)
      continue
    }

    // Scramble only tag lines
    const scrambled = line
      .replace(/ {2,}/g, ' ')
      .replace(/\s*=\s*/g, '=')
      .replace(/\s+\/>/g, ' />')
      .replace(/^\s+/, '')
      .replace(/\s+$/, '')

    result.push(scrambled)
  }

  return result.join('\n')
}

function simulateYamlMistakes(content) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // Preserve blank lines, comments, block indicators, and YAML document markers
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

      // Preserve lines starting with a quoted key entirely.
      if (/^['"].+['"]\s*:/.test(trimmed)) {
        return line
      }

      // Minimal change: normalize colon spacing on unquoted keys.
      // This replaces any spaces (or lack thereof) before and after a colon with exactly one space after.
      return line.replace(/\s*:\s*/g, ': ')
    })
    .join('\n')
}

function simulateSqlMistakes(content) {
  return content
    .replace(/ {2,}/g, ' ')
    .replace(/\t+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/gm, '') // unindent
}

function simulateNginxMistakes(content) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // Preserve blank lines and comments as-is.
      if (trimmed === '' || trimmed.startsWith('#')) {
        return line
      }

      // Minimal changes for non-comment lines:
      let scrambled = line

      // Remove leading indentation.
      scrambled = scrambled.replace(/^\s+/, '')

      // Collapse multiple spaces into one.
      scrambled = scrambled.replace(/\s{2,}/g, ' ')

      // Remove extra spaces before semicolons.
      scrambled = scrambled.replace(/\s*;/g, ';')

      // Normalize spacing around braces.
      scrambled = scrambled.replace(/\s*{\s*/g, ' { ')
      scrambled = scrambled.replace(/\s*}\s*/g, ' } ')

      return scrambled
    })
    .join('\n')
}

function simulateJavaMistakes(content) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // Don't touch comments or annotations
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

      // Add safe extra spaces between identifiers (but not operators)
      modified = modified.replace(
        /\b([a-zA-Z_][a-zA-Z0-9_]*)\b(?=\s+\b[a-zA-Z_][a-zA-Z0-9_]*\b)/g,
        (match) => match + ' '.repeat(Math.random() < 0.5 ? 0 : 1),
      )

      // Slightly mess with spacing after control keywords
      modified = modified.replace(
        /\b(public|private|protected|if|else|while|for|return|static|final|class)\b\s+/g,
        (match, keyword) =>
          keyword + ' '.repeat(1 + Math.floor(Math.random() * 2)),
      )

      // Avoid touching operators or structural punctuation
      return modified
    })
    .join('\n')
}

function simulatePropertiesMistake(content) {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim()

      // Leave comments and blank lines alone
      if (trimmed === '' || trimmed.startsWith('#')) return line

      // Continuation or multi-line: keep indent and continuation slashes
      if (line.match(/\\\s*$/)) return line

      // Match key-value pairs with either = or :
      const match = line.match(/^(\s*)([^:=]+?)(\s*)([:=])(\s*)(.*)$/)
      if (!match) return line

      const [, indent, key, preSepSpace, sep, postSepSpace, value] = match

      let newLine = indent

      // Some lines lose spacing around separators
      const random = Math.random()
      if (random < 0.3) {
        newLine += key + sep + value
      } else if (random < 0.6) {
        newLine += key + sep + ' ' + value
      } else {
        newLine += key + ' ' + sep + '  ' + value
      }

      // Occasionally indent the line
      if (Math.random() < 0.1) {
        newLine = '  ' + newLine
      }

      return newLine
    })
    .join('\n')
}
