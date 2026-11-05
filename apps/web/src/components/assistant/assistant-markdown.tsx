'use client';

import Link from 'next/link';
import { Children, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { splitAmounts } from './split-amounts';

const ALLOWED = ['p', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'br', 'code'];

/** Keeps every amount of a block readable inside right-to-left text. */
function withAmounts(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child !== 'string'
      ? child
      : splitAmounts(child).map((part, i) =>
          part.amount ? (
            <bdi key={i} dir="ltr" className="num whitespace-nowrap">
              {part.text}
            </bdi>
          ) : (
            part.text
          ),
        ),
  );
}

/**
 * Answers may repeat text from the database, so a client's name could carry Markdown.
 * No raw HTML (react-markdown's default), no image (it would call out to any server),
 * and a link only opens a screen of the app; anything else stays plain text.
 */
export function AssistantMarkdown({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  return (
    <ReactMarkdown
      allowedElements={ALLOWED}
      unwrapDisallowed
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{withAmounts(children)}</p>,
        li: ({ children }) => <li>{withAmounts(children)}</li>,
        strong: ({ children }) => <strong>{withAmounts(children)}</strong>,
        em: ({ children }) => <em>{withAmounts(children)}</em>,
        ul: ({ children }) => (
          <ul className="mb-2 list-disc space-y-1 ps-5 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal space-y-1 ps-5 last:mb-0">{children}</ol>
        ),
        code: ({ children }) => <bdi className="font-medium">{children}</bdi>,
        a: ({ href, children }) =>
          href && /^\/(?!\/)/.test(href) ? (
            <Link href={href} onClick={onNavigate} className="underline underline-offset-2">
              {children}
            </Link>
          ) : (
            <span>{children}</span>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
