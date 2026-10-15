import { lazy, Suspense } from "react"
import { useInView } from "react-intersection-observer"

import "./DeferredCodeBlock.css"

const CodeBlock = lazy(() => import("./CodeBlock"))

const PlainCodeBlock = ({ code, isWaiting = false }) => (
  <pre aria-busy={isWaiting || undefined} className="code-block-loading">
    <code>{code}</code>
  </pre>
)

const DeferredCodeBlock = ({ children: code, languageHint }) => {
  const { ref, inView } = useInView({ rootMargin: "400px 0px", triggerOnce: true })

  return (
    <div ref={ref} className="deferred-code-block">
      {inView ? (
        <Suspense fallback={<PlainCodeBlock isWaiting code={code} />}>
          <CodeBlock key={`${languageHint ?? ""}:${code}`} inView languageHint={languageHint}>
            {code}
          </CodeBlock>
        </Suspense>
      ) : (
        <PlainCodeBlock code={code} />
      )}
    </div>
  )
}

export default DeferredCodeBlock
