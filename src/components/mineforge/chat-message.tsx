'use client'

import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Bot, Check, ClipboardCopy, Download, EyeOff, FileArchive, HardDriveDownload, Loader2, PackageOpen, Save, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileCard } from './file-card'
import { parseAssistantOutput } from '@/lib/parse-files'
import { safeRelPath } from '@/lib/parse-files'
import { downloadFile, downloadZip, writeProjectFiles } from '@/lib/fs-access'
import { splitActivity, type ActivityEntry } from '@/lib/activity'
import { ActivityView } from './activity-view'
import { useToast } from '@/hooks/use-toast'
import type { GeneratedFile, ProjectDTO } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface UIMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  error?: boolean
  excluded?: boolean // hidden from the AI's context window
  /** Live Cline-style activity (thinking / file ops); rehydrated from the
   * content marker after reload. */
  activity?: ActivityEntry[]
}

interface Props {
  message: UIMessage
  activeProject: ProjectDTO | null
  onFilesSaved?: () => void
}

export function ChatMessage({ message, activeProject, onFilesSaved }: Props) {
  const { toast } = useToast()
  const [savingAll, setSavingAll] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [copiedJava, setCopiedJava] = useState(false)
  const [zipping, setZipping] = useState(false)

  const isUser = message.role === 'user'
  // Activity marker (thinking + file diffs) rides inside persisted content —
  // prefer it, fall back to the live entries streamed during generation.
  const parsed = useMemo(() => splitActivity(message.content), [message.content])
  const activityEntries: ActivityEntry[] =
    parsed.entries.length > 0 ? parsed.entries : (message.activity ?? [])
  const rawContent = parsed.entries.length > 0 ? parsed.content : message.content
  const segments = !isUser ? parseAssistantOutput(rawContent) : []
  const files: GeneratedFile[] = segments
    .filter((s) => s.type === 'code' && s.closed)
    .map((s) => (s.type === 'code' ? s.code : null))
    .filter((c): c is GeneratedFile => c !== null)
    .map((f) => {
      const safe = safeRelPath(f.path)
      return safe ? { ...f, path: safe } : null
    })
    .filter((f): f is GeneratedFile => f !== null)

  // ---- paste-and-play intelligence ------------------------------------------
  const javaFiles = useMemo(() => files.filter((f) => f.path.endsWith('.java')), [files])
  const isDatapack = useMemo(() => files.some((f) => f.path.endsWith('.mcfunction')), [files])
  const isShaderPack = useMemo(() => files.some((f) => /\.(fsh|vsh|glsl)$/.test(f.path)), [files])
  const zipName = useMemo(() => {
    const roots = new Set(files.map((f) => f.path.split('/')[0]))
    if (roots.size === 1 && files.every((f) => f.path.includes('/'))) {
      const root = [...roots][0].replace(/[^\w.-]+/g, '_').slice(0, 40)
      if (root) return root
    }
    return isDatapack ? 'datapack' : isShaderPack ? 'shaderpack' : 'mineforge-pack'
  }, [files, isDatapack, isShaderPack])

  const copyJava = async () => {
    const f = javaFiles[0]
    if (!f) return
    try {
      await navigator.clipboard.writeText(f.content)
      setCopiedJava(true)
      setTimeout(() => setCopiedJava(false), 1600)
    } catch {
      toast({ title: 'Clipboard unavailable', description: 'Use the Download button instead.', variant: 'destructive' })
    }
  }

  const downloadZipAll = async () => {
    setZipping(true)
    try {
      await downloadZip(zipName, files)
      toast({
        title: `${zipName}.zip downloaded`,
        description: isDatapack
          ? 'Drop it into saves/<your world>/datapacks and run /reload — instant.'
          : isShaderPack
            ? 'Drop it into .minecraft/shaderpacks and select it in Video Settings.'
            : 'Unzip it wherever you need the files.',
      })
    } catch (e) {
      toast({ title: 'Could not build the zip', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setZipping(false)
    }
  }

  const saveFiles = async (toSave: GeneratedFile[]) => {
    if (!activeProject) return
    setSavingAll(true)
    try {
      const result = await writeProjectFiles(activeProject, toSave)
      const errors = result.errors ?? []
      if (errors.length > 0) {
        toast({
          title: `Saved ${result.written} of ${toSave.length} files`,
          description: errors.slice(0, 3).join(' • '),
          variant: 'destructive',
        })
      } else {
        toast({
          title: `${result.written} file${result.written === 1 ? '' : 's'} saved → ${activeProject.name}`,
          description: toSave.map((f) => f.path).slice(0, 3).join('\n') + (toSave.length > 3 ? `\n+${toSave.length - 3} more` : ''),
        })
      }
      setSavedCount((c) => c + result.written)
      onFilesSaved?.()
    } catch (e) {
      toast({
        title: 'Could not write to folder',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSavingAll(false)
    }
  }

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex max-w-[85%] items-start gap-2.5">
          <div className="rounded-xl rounded-tr-sm border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5 text-[13.5px] leading-relaxed text-foreground">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        </div>
        {message.excluded && (
          <span className="mr-9 inline-flex items-center gap-1 text-[10px] font-medium text-amber-500/90">
            <EyeOff className="h-3 w-3" /> not sent to AI — excluded from context
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-emerald-50 shadow">
        <Bot className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div
          className={cn(
            'space-y-3 rounded-xl rounded-tl-sm border px-3.5 py-3 text-[13.5px] leading-relaxed',
            message.error ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-card'
          )}
        >
          <ActivityView entries={activityEntries} streaming={message.streaming} />
          {segments.map((seg, i) =>
            seg.type === 'text' ? (
              <div key={i} className="chat-prose break-words text-foreground/90">
                <ReactMarkdown>{seg.content}</ReactMarkdown>
              </div>
            ) : (
              <FileCard
                key={i}
                file={seg.code}
                closed={seg.closed}
                activeProject={activeProject}
                onSave={(f) => saveFiles([f])}
                saving={savingAll}
              />
            )
          )}
          {message.streaming && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-500">
              <Loader2 className="h-3 w-3 animate-spin" /> generating…
            </span>
          )}
        </div>

        {message.excluded && !message.streaming && (
          <p className="flex items-center gap-1 pl-0.5 text-[10px] font-medium text-amber-500/90">
            <EyeOff className="h-3 w-3" /> not sent to AI — excluded from context
          </p>
        )}

        {!message.streaming && files.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pl-0.5">
            {activeProject && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 text-emerald-50 hover:bg-emerald-500"
                onClick={() => saveFiles(files)}
                disabled={savingAll}
              >
                {savingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {savedCount > 0 ? `Save again (${files.length} files)` : `Save all ${files.length} files → ${activeProject.name}`}
              </Button>
            )}

            {/* THE paste-and-play button: one .java file → clipboard → paste into their folder */}
            {javaFiles.length === 1 && (
              <Button
                size="sm"
                onClick={copyJava}
                className={cn(
                  'h-8 gap-1.5',
                  activeProject
                    ? 'border border-amber-500/40 bg-transparent text-amber-500 hover:bg-amber-500/10'
                    : 'bg-amber-500 text-amber-950 hover:bg-amber-400'
                )}
              >
                {copiedJava ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                {copiedJava ? 'Copied — paste it in your folder' : `Copy ${javaFiles[0].path.split('/').pop()}`}
              </Button>
            )}

            {/* multi-file output (datapack / shader pack / full project) → one zip */}
            {files.length > 1 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"
                onClick={downloadZipAll}
                disabled={zipping}
              >
                {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
                Download .zip{isDatapack ? ' — paste & play' : ''}
              </Button>
            )}

            {/* single non-java file → plain download */}
            {files.length === 1 && javaFiles.length === 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                onClick={() => files.forEach((f) => downloadFile(f.path, f.content))}
              >
                <Download className="h-3.5 w-3.5" /> Download file
              </Button>
            )}

            {isDatapack && files.length > 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <PackageOpen className="h-3 w-3 shrink-0 text-orange-400" />
                {'drop the zip into saves/<world>/datapacks → /reload → works'}
              </span>
            )}
            {!isDatapack && javaFiles.length === 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <HardDriveDownload className="h-3 w-3 shrink-0" />
                {activeProject
                  ? 'or copy it and paste anywhere in your sources'
                  : 'connect a project folder to write it straight to your PC'}
              </span>
            )}
            {!activeProject && !isDatapack && javaFiles.length === 0 && files.length > 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <HardDriveDownload className="h-3 w-3 shrink-0" />
                connect a project folder to write files directly to your PC
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
