# Markdown Test File

This file is intended to test the formatting capabilities of the Nova Prettier Extension for Markdown. It contains various Markdown syntax elements, including headings, paragraphs, lists, blockquotes, inline code, fenced code blocks, tables, links, images, and more.

## Headings

# Heading 1

## Heading 2

### Heading 3

## Paragraphs

This is a paragraph with some sample text. It is designed to test how the formatter handles long lines, extra spaces, and line wrapping.

Another paragraph follows, with **bold text**, _italic text_, and **_bold italic text_**.

## Lists

### Unordered List (hyphens)

- Item one
- Item two
  - Nested item
  - Another nested item
    - Deep nested item

### Unordered List (asterisks)

- Item A
- Item B
  - Nested A
  - Nested B

### Ordered List

1. First item
2. Second item
   1. Sub-item 1
   2. Sub-item 2

## Blockquotes

> This is a blockquote that spans multiple lines.
> It should be indented properly and maintain its structure.

> Nested level one
>
> > Nested blockquote level two

## Tables

| Left | Center | Right |
| :--- | :----: | ----: |
| a    |   b    |     c |
| aa   |   bb   |    cc |

## Task Lists

- [x] Scramble the samples
- [x] Format in Nova
- [ ] Eyeball the output

## Links and Reference Links

Autolink: <https://example.com>

Inline [link](https://example.com), reference [ref][nova-docs], and
bare www.example.com.

[nova-docs]: https://docs.example.com/nova 'Nova Docs'

## Line Breaks and Rules

Hard break: trailing two spaces
then a new line.

Thematic break:

---

Setext heading
==============

## Inline Code

Use `npm install` to install dependencies.

## Fenced Code Block

```javascript
// Example JavaScript code block
function greet(name) {
  return `Hello, ${name}!`
}
console.log(greet('Nova'))
```
