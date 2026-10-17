declare module 'react-syntax-highlighter' {
  import { ComponentType, ReactNode } from 'react'

  export interface SyntaxHighlighterProps {
    language?: string
    style?: Record<string, unknown>
    children: string | ReactNode
    showLineNumbers?: boolean
    wrapLongLines?: boolean
    customStyle?: React.CSSProperties
    codeTagProps?: React.HTMLAttributes<HTMLElement>
    useInlineStyles?: boolean
    [key: string]: unknown
  }

  export const Prism: ComponentType<SyntaxHighlighterProps>
  export const Light: ComponentType<SyntaxHighlighterProps>
  const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps>
  export default SyntaxHighlighter
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const oneDark: Record<string, unknown>
  export const oneLight: Record<string, unknown>
  export const vscDarkPlus: Record<string, unknown>
}
