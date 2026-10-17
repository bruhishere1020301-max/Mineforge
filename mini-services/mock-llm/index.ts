// MineForge Mock LLM — a tiny OpenAI-compatible server for trying the app without real API keys.
// Runs on port 3030. Add it as a provider with Base URL: http://localhost:3030/v1 and any API key.
const PORT = 3030

const MOD_REPLY = [
  'Here is a complete **Fabric 1.21.1** mod: a Ruby set — ore, gem, tools and armor. Assumptions: Fabric loader 0.16.x, Java 21, Yarn mappings.',
  '',
  '```gradle path="gradle.properties"',
  'org.gradle.jvmargs=-Xmx2G',
  'org.gradle.parallel=true',
  '',
  '# Fabric Properties (check https://fabricmc.net/develop)',
  'minecraft_version=1.21.1',
  'yarn_mappings=1.21.1+build.3',
  'loader_version=0.16.5',
  'fabric_version=0.102.0+1.21.1',
  '',
  '# Mod Properties',
  'mod_version=1.0.0',
  'maven_group=com.example.rubymod',
  'archives_base_name=rubymod',
  '```',
  '',
  '```groovy path="build.gradle"',
  "plugins {",
  "\tid 'fabric-loom' version '1.7-SNAPSHOT'",
  "\tid 'maven-publish'",
  '}',
  '',
  'version = project.mod_version',
  'group = project.maven_group',
  '',
  'base { archivesName = project.archives_base_name }',
  '',
  'dependencies {',
  "\tminecraft \"com.mojang:minecraft:${project.minecraft_version}\"",
  "\tmappings \"net.fabricmc:yarn:${project.yarn_mappings}:v2\"",
  "\tmodImplementation \"net.fabricmc:fabric-loader:${project.loader_version}\"",
  "\tmodImplementation \"net.fabricmc.fabric-api:fabric-api:${project.fabric_version}\"",
  '}',
  '```',
  '',
  '```json path="src/main/resources/fabric.mod.json"',
  '{',
  '  "schemaVersion": 1,',
  '  "id": "rubymod",',
  '  "version": "1.0.0",',
  '  "name": "Ruby Mod",',
  '  "description": "Adds ruby ore, gems, tools and armor.",',
  '  "authors": ["MineForge AI"],',
  '  "license": "MIT",',
  '  "environment": "*",',
  '  "entrypoints": {',
  '    "main": ["com.example.rubymod.RubyMod"]',
  '  },',
  '  "depends": {',
  '    "fabricloader": ">=0.16.0",',
  '    "minecraft": "~1.21.1",',
  '    "java": ">=21",',
  '    "fabric-api": "*"',
  '  }',
  '}',
  '```',
  '',
  '```java path="src/main/java/com/example/rubymod/RubyMod.java"',
  'package com.example.rubymod;',
  '',
  'import net.fabricmc.api.ModInitializer;',
  'import net.minecraft.item.Item;',
  'import net.minecraft.item.ItemGroup;',
  'import net.minecraft.item.ItemGroups;',
  'import net.minecraft.item.ToolItem;',
  'import net.minecraft.registry.Registries;',
  'import net.minecraft.registry.Registry;',
  'import net.minecraft.util.Identifier;',
  'import net.minecraft.item.SwordItem;',
  'import net.minecraft.item.ToolMaterials;',
  'import net.minecraft.item.FoodComponents;',
  '',
  'public class RubyMod implements ModInitializer {',
  '\tpublic static final String MOD_ID = "rubymod";',
  '',
  '\tpublic static final Item RUBY = register("ruby", new Item(new Item.Settings()));',
  '\tpublic static final Item RUBY_SWORD = register("ruby_sword",',
  '\t\tnew SwordItem(ToolMaterials.DIAMOND, new Item.Settings().swordItem()));',
  '',
  '\tprivate static Item register(String name, Item item) {',
  '\t\treturn Registry.register(Registries.ITEM, Identifier.of(MOD_ID, name), item);',
  '\t}',
  '',
  '\t@Override',
  '\tpublic void onInitialize() {',
  '\t\tItemGroupEvents.modifyEntriesEvent(ItemGroups.INGREDIENTS)',
  '\t\t\t.register(entries -> entries.add(RUBY));',
  '\t\tItemGroupEvents.modifyEntriesEvent(ItemGroups.COMBAT)',
  '\t\t\t.register(entries -> entries.add(RUBY_SWORD));',
  '\t}',
  '}',
  '```',
  '',
  '```json path="src/main/resources/assets/rubymod/lang/en_us.json"',
  '{',
  '  "item.rubymod.ruby": "Ruby",',
  '  "item.rubymod.ruby_sword": "Ruby Sword"',
  '}',
  '```',
  '',
  '### Build & Test',
  '1. `gradlew build` — jar lands in `build/libs/rubymod-1.0.0.jar`',
  '2. Drop the jar into `.minecraft/mods` with Fabric Loader + Fabric API installed.',
  '',
].join('\n')

const SHADER_REPLY = [
  'Here is a compact **Iris + OptiFine compatible** shader pack: bright cartoon look with soft shadows and waving water.',
  '',
  '```properties path="shaders/shaders.properties"',
  '# MineForge Cartoon Shader',
  'profile.CARTOON=卡通',
  'shadowMapResolution=1024',
  'shadowDistance=96.0',
  'sunPathRotation=-25.0',
  '```',
  '',
  '```glsl path="shaders/lib/settings.glsl"',
  '// Shared settings for all passes',
  '#ifndef SETTINGS_GLSL',
  '#define SETTINGS_GLSL',
  '',
  '#define BRIGHTNESS 1.12',
  '#define SATURATION 1.18',
  '#define SHADOW_SOFTNESS 1.0',
  '',
  '#endif',
  '```',
  '',
  '```glsl path="shaders/composite.vsh"',
  '#version 120',
  '',
  'varying vec2 texcoord;',
  '',
  'void main() {',
  '\tgl_Position = ftransform();',
  '\ttexcoord = (gl_MultiTexCoord0).xy;',
  '}',
  '```',
  '',
  '```glsl path="shaders/composite.fsh"',
  '#version 120',
  '',
  'uniform sampler2D colortex0;',
  'varying vec2 texcoord;',
  '',
  '#include "/lib/settings.glsl"',
  '',
  'void main() {',
  '\tvec3 color = texture2D(colortex0, texcoord).rgb;',
  '\t// cartoon: quantize brightness slightly, boost saturation',
  '\tcolor *= BRIGHTNESS;',
  '\tfloat luma = dot(color, vec3(0.2126, 0.7152, 0.0722));',
  '\tcolor = mix(vec3(luma), color, SATURATION);',
  '\tcolor = floor(color * 24.0) / 24.0; // banded cel look',
  '\tgl_FragData[0] = vec4(color, 1.0);',
  '}',
  '```',
  '',
  '```glsl path="shaders/final.fsh"',
  '#version 120',
  '',
  'uniform sampler2D colortex0;',
  'varying vec2 texcoord;',
  '',
  'void main() {',
  '\tvec3 color = texture2D(colortex0, texcoord).rgb;',
  '\t// gentle vignette for that storybook frame',
  '\tfloat d = distance(texcoord, vec2(0.5));',
  '\tcolor *= 1.0 - 0.25 * d * d;',
  '\tgl_FragColor = vec4(color, 1.0);',
  '}',
  '```',
  '',
  '### Install',
  'Zip the `shaders/` folder contents so the zip contains `shaders/` at its root, drop it into `.minecraft/shaderpacks`, select it in Options → Video Settings → Shader Packs.',
  '',
].join('\n')

// Demo reply for SINGLE-FILE mode — ONE self-contained .java file (+ optional loader metadata)
const SINGLE_REPLY = [
  'One file, as ordered — a **self-contained Ruby Sword mod** for Fabric 1.21.1. The item, registration and the fire-on-hit logic all live in this single .java file:',
  '',
  '```java path="src/main/java/com/example/rubysword/RubySwordMod.java"',
  'package com.example.rubysword;',
  '',
  'import net.fabricmc.api.ModInitializer;',
  'import net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents;',
  'import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;',
  'import net.minecraft.entity.mob.MobEntity;',
  'import net.minecraft.item.Item;',
  'import net.minecraft.item.ItemGroups;',
  'import net.minecraft.item.SwordItem;',
  'import net.minecraft.item.ToolMaterials;',
  'import net.minecraft.registry.Registries;',
  'import net.minecraft.registry.Registry;',
  'import net.minecraft.server.network.ServerPlayerEntity;',
  'import net.minecraft.util.Identifier;',
  '',
  '/**',
  ' * Single-file mod: everything the mod needs lives in this one class.',
  ' * Paste it into src/main/java/com/example/rubysword/ of a Fabric project and build.',
  ' */',
  'public class RubySwordMod implements ModInitializer {',
  '\tpublic static final String MOD_ID = "rubysword";',
  '',
  '\tpublic static final Item RUBY_SWORD = Registry.register(',
  '\t\tRegistries.ITEM,',
  '\t\tIdentifier.of(MOD_ID, "ruby_sword"),',
  '\t\tnew SwordItem(ToolMaterials.DIAMOND, new Item.Settings().swordItem())',
  '\t);',
  '',
  '\t@Override',
  '\tpublic void onInitialize() {',
  '\t\tItemGroupEvents.modifyEntriesEvent(ItemGroups.COMBAT)',
  '\t\t\t.register(entries -> entries.add(RUBY_SWORD));',
  '',
  '\t\t// Fire-on-hit with ZERO extra files — a Fabric API event does the work.',
  '\t\tServerLivingEntityEvents.AFTER_DAMAGE.register((entity, source, amount) -> {',
  '\t\t\tif (entity instanceof MobEntity mob',
  '\t\t\t\t\t&& source.getDirectSource() instanceof ServerPlayerEntity player',
  '\t\t\t\t\t&& player.getMainHandStack().isOf(RUBY_SWORD)) {',
  '\t\t\t\tmob.setOnFireForSeconds(4.0f);',
  '\t\t\t}',
  '\t\t\treturn true;',
  '\t\t});',
  '\t}',
  '}',
  '```',
  '',
  'Optional companion (skip it if your project already has a `fabric.mod.json` — then just align the `main` entrypoint with `com.example.rubysword.RubySwordMod`):',
  '',
  '```json path="src/main/resources/fabric.mod.json"',
  '{',
  '  "schemaVersion": 1,',
  '  "id": "rubysword",',
  '  "version": "1.0.0",',
  '  "name": "Ruby Sword (single file)",',
  '  "environment": "*",',
  '  "entrypoints": { "main": ["com.example.rubysword.RubySwordMod"] },',
  '  "depends": { "fabricloader": ">=0.16.0", "minecraft": "~1.21.1", "java": ">=21", "fabric-api": "*" }',
  '}',
  '```',
  '',
  '### Paste & run',
  '1. Click **Copy RubySwordMod.java** above, then paste it into `src/main/java/com/example/rubysword/` of a Fabric project (the [fabric-example-mod](https://fabricmc.net/develop/template/) template works out of the box).',
  '2. Fresh template? Also drop the `fabric.mod.json` into `src/main/resources/`. Existing project? Just align the entrypoint.',
  '3. `./gradlew build` → the jar lands in `build/libs/` — drop it into `.minecraft/mods` (Fabric Loader + Fabric API).',
  '',
].join('\n')

// Demo reply for DATAPACK mode — instant, paste-and-play, no Java
const DATAPACK_REPLY = [
  'An **instant datapack** — no Java, no compiler. Bonus Mining gives mined stone & ores a 10% chance of bonus loot. Drop the folder into your world and `/reload`:',
  '',
  '```json path="BonusMining/pack.mcmeta"',
  '{',
  '  "pack": {',
  '    "pack_format": 48,',
  '    "description": "Bonus Mining — 10% chance for bonus loot while mining"',
  '  }',
  '}',
  '```',
  '',
  '```mcfunction path="BonusMining/data/bonusmining/function/load.mcfunction"',
  '# Runs once when the pack loads (wired via the minecraft:load tag below).',
  'scoreboard objectives add bonusmining.roll dummy',
  'tellraw @a {"text":"[BonusMining] loaded — mine stone & ores for bonus loot!","color":"gold"}',
  '```',
  '',
  '```mcfunction path="BonusMining/data/bonusmining/function/bonus.mcfunction"',
  '# Reward function — runs as the player via the advancement below.',
  'execute store result score @s bonusmining.roll run random roll 1..10',
  '# 10% chance → roll 1',
  'execute if score @s bonusmining.roll matches 1 run give @s iron_ingot',
  'advancement revoke @s only bonusmining:mined_pickup',
  '```',
  '',
  '```json path="BonusMining/data/bonusmining/advancement/mined_pickup.json"',
  '{',
  '  "criteria": {',
  '    "picked_up": {',
  '      "trigger": "minecraft:inventory_changed",',
  '      "conditions": { "items": [ { "items": ["cobblestone", "raw_iron", "raw_copper", "coal", "diamond"] } ] }',
  '    }',
  '  },',
  '  "rewards": { "function": "bonusmining:bonus" }',
  '}',
  '```',
  '',
  '```json path="BonusMining/data/minecraft/tags/function/load.json"',
  '{ "values": ["bonusmining:load"] }',
  '```',
  '',
  '### Install — instant',
  '1. Click **Download .zip — paste & play** above → you get `BonusMining.zip`.',
  '2. Drop it into `.minecraft/saves/<your world>/datapacks/`.',
  '3. In-game run `/reload`. Mine stone — bonus loot, no mods folder, nothing to compile.',
  '',
].join('\n')

function sse(chunk: string): Uint8Array {
  return new TextEncoder().encode(chunk)
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // CORS (not strictly needed for server-to-server, but harmless)
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    }
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors })

    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } })

    if (url.pathname.endsWith('/models') && req.method === 'GET') {
      return json({
        object: 'list',
        data: [
          { id: 'mineforge-mock-mod', display_name: 'MineForge Mock (Mod Engineer)' },
          { id: 'mineforge-mock-shader', display_name: 'MineForge Mock (Shader Engineer)' },
          { id: 'mineforge-mock-creative', display_name: 'MineForge Mock (Creative)' },
        ],
      })
    }

    if (url.pathname.endsWith('/chat/completions') && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as {
        stream?: boolean
        messages?: Array<{
          role: string
          content?: string | null
          tool_call_id?: string
          tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
        }>
        tools?: Array<{ function?: { name?: string; description?: string; parameters?: Record<string, unknown> } }>
      }
      const msgs = body.messages ?? []
      const sysCount = msgs.filter((m) => m.role === 'system').length
      const chat = msgs.filter((m) => m.role !== 'system')
      const users = chat.filter((m) => m.role === 'user')
      const last = (users[users.length - 1]?.content ?? '').toString()
      const prevUser = users.length > 1 ? (users[users.length - 2]?.content ?? '').toString() : null

      // Mode detection — trust the app's system prompt first, fall back to user-text heuristics.
      const sys = msgs
        .filter((m) => m.role === 'system')
        .map((m) => (m.content ?? '').toString())
        .join('\n')
      const wantsSingle =
        /Single-File Mod Engineer/i.test(sys) || /single[- ]file\b|one file\b|single java file/i.test(last)
      const wantsDatapack =
        /Datapack Engineer/i.test(sys) || /data ?pack\b/i.test(last)
      const wantsShader = /Shader Engineer/i.test(sys) || /shader|glsl|shadow|water|cartoon|cinematic|fog|godray/i.test(last)
      const pickReply = () =>
        wantsSingle ? SINGLE_REPLY : wantsDatapack ? DATAPACK_REPLY : wantsShader ? SHADER_REPLY : MOD_REPLY

      // Context-window receipt — visible proof of what the app actually sent us.
      const trim = (s: string, n: number) => {
        const t = s.replace(/\s+/g, ' ').trim()
        return t.length > n ? `${t.slice(0, n)}…` : t
      }
      const contextLine = prevUser
        ? `**Context window receipt** — I received ${msgs.length} messages (${sysCount} system + ${chat.length} conversation). I remember what you said before: “${trim(prevUser, 110)}”`
        : `**Context window receipt** — I received ${msgs.length} messages (${sysCount} system + ${chat.length} conversation). This is the first message of the session, so there is nothing earlier to remember.`

      // ---- MCP tool-calling support (demos the app's agent loop offline) ----
      const hasToolResult = msgs.some((m) => m.role === 'tool')
      if (body.tools?.length && !hasToolResult) {
        // First round: request the most relevant MCP tool with sensible args from its schema.
        const allNames = body.tools.map((t) => t.function?.name ?? '')
        let pickIndex = 0
        if (wantsShader) {
          const i = allNames.findIndex((n) => n.includes('shader'))
          if (i !== -1) pickIndex = i
        } else if (/layout|structure|project|scaffold|template/i.test(last)) {
          const i = allNames.findIndex((n) => n.includes('layout') || n.includes('project'))
          if (i !== -1) pickIndex = i
        } else if (/version|update|fabric|forge|neoforge/i.test(last)) {
          const i = allNames.findIndex((n) => n.includes('version'))
          if (i !== -1) pickIndex = i
        }
        const fn = body.tools[pickIndex]?.function
        const name = fn?.name ?? 'unknown'
        const params = fn?.parameters ?? {}
        const props = (params.properties ?? {}) as Record<string, Record<string, unknown>>
        const required = (params.required as string[] | undefined) ?? Object.keys(props)
        const args: Record<string, unknown> = {}
        for (const key of required) {
          const p = props[key] ?? {}
          if (Array.isArray(p.enum) && p.enum.length > 0) args[key] = p.enum[0]
          else if (p.type === 'number' || p.type === 'integer') args[key] = 1
          else if (p.type === 'boolean') args[key] = true
          else {
            const k = key.toLowerCase()
            if (k.includes('loader')) args[key] = 'fabric'
            else if (k.includes('mc') || k.includes('minecraft')) args[key] = '1.21.1'
            else if (k.includes('query') || k.includes('search')) args[key] = last.replace(/\s+/g, ' ').trim().slice(0, 60) || 'item registration'
            else args[key] = 'fabric'
          }
        }
        return json({
          id: 'chatcmpl-mock-tools',
          object: 'chat.completion',
          created: (Date.now() / 1000) | 0,
          model: 'mineforge-mock',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_mock_1',
                    type: 'function',
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        })
      }

      let reply = `${contextLine}\n\n${pickReply()}`

      if (hasToolResult) {
        // Final round after the app executed the MCP tool — report what we got back.
        const lastToolMsg = [...msgs].reverse().find((m) => m.role === 'tool')
        const toolResult = typeof lastToolMsg?.content === 'string' ? lastToolMsg.content : ''
        const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant' && m.tool_calls?.length)
        const calledTool = lastAssistant?.tool_calls?.[0]?.function?.name ?? 'mcp tool'
        // Tool results may contain their own ``` fences — swap them for ~~~ so the
        // wrapper fences below stay balanced and the app's file parser never shifts.
        const cleanResult = toolResult.replace(/```/g, '~~~').slice(0, 400)
        const mcpLine = [
          '**MCP round-trip** — I called the MCP tool `' + calledTool + '` and received:',
          '',
          '```',
          cleanResult || '(empty result)',
          '```',
          '',
          'Using that information, here is the result:',
          '',
        ].join('\n')
        reply = `${contextLine}\n\n${mcpLine}\n${pickReply()}`
      }

      if (!body.stream) {
        return json({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: Date.now() / 1000 | 0,
          model: 'mineforge-mock',
          choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
        })
      }

      // streamed SSE
      const chunkSize = 96
      const chunks: string[] = []
      for (let i = 0; i < reply.length; i += chunkSize) {
        chunks.push(reply.slice(i, i + chunkSize))
      }
      const stream = new ReadableStream({
        async start(controller) {
          for (const c of chunks) {
            const payload = {
              id: 'chatcmpl-mock',
              object: 'chat.completion.chunk',
              model: 'mineforge-mock',
              choices: [{ index: 0, delta: { content: c }, finish_reason: null }],
            }
            controller.enqueue(sse(`data: ${JSON.stringify(payload)}\n\n`))
            await new Promise((r) => setTimeout(r, 12)) // simulate token latency
          }
          const done = {
            id: 'chatcmpl-mock',
            object: 'chat.completion.chunk',
            model: 'mineforge-mock',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }
          controller.enqueue(sse(`data: ${JSON.stringify(done)}\n\n`))
          controller.enqueue(sse('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...cors },
      })
    }

    return json({ error: { message: `No route: ${req.method} ${url.pathname}` } }, 404)
  },
})

console.log(`[mock-llm] OpenAI-compatible mock listening on http://localhost:${PORT}/v1`)
console.log('[mock-llm] Add it in MineForge as a Local AI provider: base URL http://localhost:3030/v1, no API key needed.')
console.log('[mock-llm] Supports tool-calling — pairs with the MCP demo server on :3031 for a full agent-loop demo.')
