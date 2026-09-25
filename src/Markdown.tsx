// Markdown ответов модели (чат, саммари). Сырой HTML не рендерим (react-markdown по умолчанию безопасен).
import { ClockIcon } from "@radix-ui/react-icons"
import { useMemo } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

import { cn } from "@/lib/utils"

import { linkifyTimestamps, seekTarget } from "./timestamps"

function Link({ node, ...props }: React.ComponentProps<"a"> & { node?: unknown }) {
  return <a className="underline underline-offset-2 hover:opacity-80" target="_blank" rel="noopener noreferrer" {...props} />
}

const baseComponents: Components = {
  p: ({ node, ...props }) => <p className="my-2 first:mt-0 last:mb-0" {...props} />,
  strong: ({ node, ...props }) => <strong className="font-semibold" {...props} />,
  em: ({ node, ...props }) => <em className="italic" {...props} />,
  ul: ({ node, ...props }) => <ul className="my-2 list-disc space-y-1 pl-5" {...props} />,
  ol: ({ node, ...props }) => <ol className="my-2 list-decimal space-y-1 pl-5" {...props} />,
  li: ({ node, ...props }) => <li className="pl-1 [&>ol]:my-1 [&>p]:my-0 [&>ul]:my-1" {...props} />,
  h1: ({ node, ...props }) => <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0" {...props} />,
  h2: ({ node, ...props }) => <h3 className="mb-2 mt-3 text-base font-semibold first:mt-0" {...props} />,
  h3: ({ node, ...props }) => <h4 className="mb-1 mt-3 font-semibold first:mt-0" {...props} />,
  h4: ({ node, ...props }) => <h4 className="mb-1 mt-3 font-semibold first:mt-0" {...props} />,
  a: Link,
  blockquote: ({ node, ...props }) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground" {...props} />
  ),
  hr: () => <hr className="my-3 border-border" />,
  code: ({ node, className, children, ...props }) => {
    const block = /language-/.test(className || "") || String(children).includes("\n")
    return block ? (
      <code className={cn("block overflow-x-auto whitespace-pre rounded bg-background p-2 font-mono text-xs", className)} {...props}>
        {children}
      </code>
    ) : (
      <code className="rounded bg-background px-1 py-0.5 font-mono text-[0.85em]" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ node, ...props }) => <pre className="my-2" {...props} />,
  table: ({ node, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => <th className="border px-2 py-1 font-semibold" {...props} />,
  td: ({ node, ...props }) => <td className="border px-2 py-1 align-top" {...props} />
}

/** onSeek — метки [m:ss] в тексте становятся кнопками перемотки плеера. */
export function Markdown({
  children,
  className,
  onSeek,
  duration
}: {
  children: string
  className?: string
  onSeek?: (seconds: number) => void
  duration?: number
}) {
  const components = useMemo<Components>(
    () =>
      onSeek
        ? {
            ...baseComponents,
            a: ({ node, href, children: label, ...props }) => {
              const t = seekTarget(href)
              if (t === null) return <Link href={href} {...props}>{label}</Link>
              return (
                <button
                  type="button"
                  onClick={() => onSeek(t)}
                  title="Перейти к этому моменту видео"
                  className="mx-0.5 inline-flex items-center gap-1 rounded border bg-background px-1.5 py-0 align-baseline font-mono text-xs text-primary hover:bg-accent">
                  <ClockIcon className="h-3 w-3" />
                  {label}
                </button>
              )
            }
          }
        : baseComponents,
    [onSeek]
  )
  const text = useMemo(() => (onSeek ? linkifyTimestamps(children, duration) : children), [children, onSeek, duration])
  return (
    <div className={cn("min-w-0 [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
