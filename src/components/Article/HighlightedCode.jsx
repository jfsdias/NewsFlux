import getCodeLineCount from "@/utils/code-block"
import { registerLanguages, SyntaxHighlighter } from "@/utils/highlighter"

registerLanguages()

const HighlightedCode = ({ children: code, language, showLineNumbers, wrapLongLines }) => {
  const lineClassName = showLineNumbers
    ? "code-block-line code-block-line-numbered"
    : "code-block-line"
  const visibleLineCount = getCodeLineCount(code)
  const getLineNumberStyle = (lineNumber) =>
    lineNumber > visibleLineCount
      ? { display: "none" }
      : wrapLongLines
        ? { minWidth: "var(--code-line-number-width)" }
        : {}
  const lineProps = wrapLongLines
    ? { className: lineClassName, style: { display: "block" } }
    : undefined

  return (
    <SyntaxHighlighter
      language={language}
      lineNumberStyle={getLineNumberStyle}
      lineProps={lineProps}
      showLineNumbers={showLineNumbers}
      useInlineStyles={false}
      wrapLongLines={wrapLongLines}
    >
      {code}
    </SyntaxHighlighter>
  )
}

export default HighlightedCode
