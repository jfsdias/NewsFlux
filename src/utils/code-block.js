export const MAX_AUTOMATIC_HIGHLIGHT_CHARACTERS = 50_000
export const MAX_AUTOMATIC_HIGHLIGHT_LINES = 1000
export const MAX_NUMBERED_LINES = 500

const getCodeLineCount = (code) => {
  if (code.length === 0) {
    return 0
  }

  let count = 1
  let index = code.indexOf("\n")
  while (index !== -1 && index < code.length - 1) {
    count++
    index = code.indexOf("\n", index + 1)
  }
  return count
}

export const splitCodeIntoLogicalLines = (code) => code.match(/[^\n]*\n|[^\n]+$/g) ?? []

export const isCodeBlockLarge = (code) =>
  code.length > MAX_AUTOMATIC_HIGHLIGHT_CHARACTERS ||
  code.split("\n", MAX_AUTOMATIC_HIGHLIGHT_LINES + 1).length > MAX_AUTOMATIC_HIGHLIGHT_LINES

export const shouldShowCodeLineNumbers = (code) => getCodeLineCount(code) <= MAX_NUMBERED_LINES

export default getCodeLineCount
