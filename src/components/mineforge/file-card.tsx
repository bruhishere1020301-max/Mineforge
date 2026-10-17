'use client'

import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Download, FileCode, FileJson, FileText, Save } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { downloadFile } from '@/lib/fs-access'
import type { GeneratedFile, ProjectDTO } from '@/lib/types'

function iconFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'json' || ext === 'mcmeta') return <FileJson className="h-3.5 w-3.5 text-amber-400" />
  if (ext === 'fsh' || ext === 'vsh' || ext === 'glsl') return <FileCode className="h-3.5 w-3.5 text-fuchsia-400" />
  if (ext === 'mcfunction') return <FileCode className="h-3.5 w-3.5 text-orange-400" />
  if (ext === 'java' || ext === 'gradle') return <FileCode className="h-3.5 w-3.5 text-emerald-400" />
  return <FileText className="h-3.5 w-3.5 text-muted-foreground" />
}

const LANG_MAP: Record<string, string> = {
  gradle: 'java',
  properties: 'java',
  mcmeta: 'json',
  toml: 'toml',
  mcfunction: 'bash', // closest Prism grammar for command-style syntax
  text: 'text',
}

interface Props {
  file: GeneratedFile
  closed: boolean
  activeProject: ProjectDTO | null
  onSave?: (file: GeneratedFile) => void
  saving?: boolean
}

export function FileCard({ file, closed, activeProject, onSave, saving }: Props) {
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const lines = file.content.split('\n').length
  const lang = LANG_MAP[file.lang] ?? file.lang

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-1.5 border-b border-border bg-secondary/40 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-label={expanded ? 'Collapse file' : 'Expand file'}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          {iconFor(file.path)}
          <span className="truncate font-mono text-[11.5px] text-foreground">{file.path}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{lines} lines</span>
          {!closed && (
            <span className="ml-1 shrink-0 animate-pulse rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-500">
              writing…
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={copy} aria-label="Copy file contents" title="Copy">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => downloadFile(file.path, file.content)}
            aria-label="Download file"
            title="Download"
          >
            <Download className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
          {activeProject && onSave && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onSave(file)}
              disabled={saving}
              aria-label="Save file to project folder"
              title={`Save to ${activeProject.name}`}
            >
              <Save className={cn('h-3.5 w-3.5', saving ? 'animate-pulse text-emerald-400' : 'text-muted-foreground')} />
            </Button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="max-h-72 overflow-auto text-[12.5px]">
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            showLineNumbers
            customStyle={{
              margin: 0,
              background: 'transparent',
              fontSize: '0.78rem',
              padding: '0.75rem 0.5rem',
            }}
            codeTagProps={{ style: { fontFamily: 'var(--font-geist-mono), monospace' } }}
          >
            {file.content}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  )
}
