// MineForge Demo MCP Server — Model Context Protocol, Streamable HTTP transport.
// A zero-dependency demo MCP server so MineForge Studio users can try MCP tools
// end-to-end without installing anything. It speaks exactly the JSON-RPC 2.0
// dialect our client (src/lib/server/mcp-client.ts) uses:
//   - POST /mcp with a JSON-RPC 2.0 body -> plain JSON response
//     (Content-Type: application/json). No SSE required.
//   - Notifications (messages with NO `id`, e.g. notifications/initialized) are
//     answered with HTTP 202 + EMPTY body — the client relies on that.
//   - initialize responses carry an `mcp-session-id` header (random uuid); the
//     client stores it and resends it — this server is stateless and echoes it.
//
// Tools (Minecraft-flavored, read-only, no side effects):
//   lookup_versions · mod_project_layout · shader_pack_layout · search_wiki
//
// Start:  cd mini-services/mcp-demo && bun run dev      (bun --hot index.ts)
// Port:   3031
// Studio: add an MCP server (HTTP transport) with URL  http://localhost:3031/mcp

const PORT = 3031
const FALLBACK_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'mineforge-demo-mcp', version: '1.0.0' }
const LOADERS: readonly string[] = ['fabric', 'forge', 'neoforge']

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
  'access-control-allow-headers':
    'Content-Type, Accept, Authorization, mcp-session-id, mcp-protocol-version, X-Requested-With',
  'access-control-expose-headers': 'mcp-session-id, mcp-protocol-version',
  'access-control-max-age': '86400',
}

function jsonResponse(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS, ...extra },
  })
}

/** 202 + empty body = notification accepted (what our MCP client expects). */
function accepted(): Response {
  return new Response(null, { status: 202, headers: { ...CORS_HEADERS } })
}

/** Echo the client's session id, or mint a fresh one on initialize. */
function sessionHeaders(req: Request, isInitialize: boolean): Record<string, string> {
  const existing = req.headers.get('mcp-session-id')
  if (existing) return { 'mcp-session-id': existing }
  if (isInitialize) return { 'mcp-session-id': crypto.randomUUID() }
  return {}
}

/* ------------------------------------------------------------------ */
/* Tool 1: lookup_versions                                             */
/* ------------------------------------------------------------------ */

interface McVersionData {
  java: string
  javaNote: string
  fabricLoader: string
  yarn: string
  fabricApi: string
  forge: string
  neoforge: string
  notes: string[]
}

const MC_VERSIONS: Record<string, McVersionData> = {
  '1.21.1': {
    java: '21',
    javaNote: 'Java 21 is required for Minecraft 1.20.5 and newer',
    fabricLoader: '0.16.14',
    yarn: '1.21.1+build.3',
    fabricApi: '0.102.0+1.21.1',
    forge: '52.1.1',
    neoforge: '21.1.77',
    notes: [
      'Supported by Fabric Loom 1.7+, ForgeGradle 6 (Forge MDK) and ModDevGradle 2.x (NeoForge MDK).',
      'Live pins: https://fabricmc.net/develop — https://files.minecraftforge.net — https://neoforged.net',
    ],
  },
  '1.20.4': {
    java: '17',
    javaNote: 'Java 17 is required for MC 1.18–1.20.4 (Java 21 also works)',
    fabricLoader: '0.16.14',
    yarn: '1.20.4+build.3',
    fabricApi: '0.97.2+1.20.4',
    forge: '49.1.12',
    neoforge: '20.4.237',
    notes: [
      'Forge 1.20.4 uses ForgeGradle 6; NeoForge 20.4.x pairs with ModDevGradle 2.x or NeoGradle 7.x.',
      'Live pins: https://fabricmc.net/develop — https://files.minecraftforge.net — https://neoforged.net',
    ],
  },
  '1.20.1': {
    java: '17',
    javaNote: 'Java 17 is required for MC 1.18–1.20.4 (Java 21 also works)',
    fabricLoader: '0.16.14',
    yarn: '1.20.1+build.10',
    fabricApi: '0.92.6+1.20.1',
    forge: '47.3.0',
    neoforge: '47.1.106',
    notes: [
      'Hugely popular modding target — both Forge and NeoForge are actively maintained for 1.20.1.',
      'Live pins: https://fabricmc.net/develop — https://files.minecraftforge.net — https://neoforged.net',
    ],
  },
  '1.19.2': {
    java: '17',
    javaNote: 'Java 17 is required for MC 1.18–1.20.4 (Java 21 also works)',
    fabricLoader: '0.16.14',
    yarn: '1.19.2+build.28',
    fabricApi: '0.77.2+1.19.2',
    forge: '43.4.0',
    neoforge: '—',
    notes: [
      'NeoForge did not exist for 1.19.2 (its first release targets 1.20.1) — use Forge 43.x for 1.19.2.',
      'Live pins: https://fabricmc.net/develop — https://files.minecraftforge.net',
    ],
  },
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function toolLookupVersions(loader: string, minecraftVersion: unknown): string {
  const requested = minecraftVersion == null ? '' : String(minecraftVersion).trim()
  const mc = requested || '1.21.1'
  const known = MC_VERSIONS[mc]
  const d = known ?? MC_VERSIONS['1.21.1']

  const lines: string[] = []
  lines.push(`## ${cap(loader)} toolchain for Minecraft ${mc}`)
  if (!known) {
    lines.push('')
    lines.push(
      `(No built-in data for Minecraft ${mc} — these are the Minecraft 1.21.1 numbers. ` +
        'Check https://fabricmc.net/develop, https://files.minecraftforge.net and https://neoforged.net for exact pins.)'
    )
  }
  lines.push('')
  lines.push('| Component | Recommended |')
  lines.push('| --- | --- |')
  lines.push(`| Minecraft | ${mc} |`)
  lines.push(`| Java | ${d.java} — ${d.javaNote} |`)

  if (loader === 'fabric') {
    lines.push(`| Fabric Loader | ${d.fabricLoader} |`)
    lines.push(`| Yarn mappings | ${d.yarn} |`)
    lines.push(`| Fabric API | ${d.fabricApi} |`)
    lines.push('')
    lines.push('Notes:')
    lines.push(
      `- Put these into gradle.properties (minecraft_version, yarn_mappings, loader_version, fabric_version) and build with Fabric Loom 1.7+.`
    )
    lines.push(
      `- fabric.mod.json depends block: "fabricloader": ">=0.16.0", "minecraft": "~${mc}", "java": ">=${d.java}", "fabric-api": "*".`
    )
  } else if (loader === 'forge') {
    lines.push(`| Forge | ${d.forge} (loader + API bundled — no separate API dependency) |`)
    lines.push(`| Mappings | Official Mojang mappings (channel: official, e.g. official-${mc}) |`)
    lines.push('')
    lines.push('Notes:')
    lines.push(
      `- Start from the Forge MDK for ${mc} (ForgeGradle 6): gradle.properties pins minecraft_version=${mc}, forge_version=${d.forge}, mappings_channel=official.`
    )
    lines.push(
      `- META-INF/mods.toml: modLoader="javafml", loaderVersion="[${d.forge.split('.')[0]},)", plus a [[dependencies]] entry on "forge".`
    )
  } else {
    lines.push(
      d.neoforge === '—'
        ? `| NeoForge | — (not available for ${mc}) |`
        : `| NeoForge | ${d.neoforge} (loader + API bundled) |`
    )
    lines.push('| Mappings | Official Mojang mappings (default in the NeoForge MDK) |')
    lines.push('')
    lines.push('Notes:')
    if (d.neoforge === '—') {
      lines.push(
        `- NeoForge is NOT available for ${mc} — use Forge ${d.forge} instead (see the version note below).`
      )
    } else {
      lines.push(
        `- Start from the NeoForge MDK for ${mc} (ModDevGradle): gradle.properties pins minecraft_version=${mc}, neoforge_version=${d.neoforge}.`
      )
      lines.push(
        `- META-INF/neoforge.mods.toml: modLoader="javafml", loaderVersion="[${d.neoforge.split('.')[0]},)", plus a [[dependencies]] entry on "neoforge".`
      )
    }
  }
  for (const n of d.notes) lines.push(`- ${n}`)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Tool 2: mod_project_layout                                          */
/* ------------------------------------------------------------------ */

const MOD_TREES: Record<string, string> = {
  fabric: `Project layout for a new **Fabric mod** (example mod id: \`rubymod\`, Java package: \`com.example.rubymod\`):

\`\`\`
myrubymod/
├─ build.gradle                          ← Fabric Loom build script: plugins { id 'fabric-loom' }, minecraft/yarn/loader/fabric-api deps
├─ gradle.properties                     ← All version pins: minecraft_version, yarn_mappings, loader_version, fabric_version + mod_version/maven_group
├─ settings.gradle                       ← Plugin repositories (Fabric maven) + rootProject.name
├─ gradlew + gradlew.bat                 ← Gradle wrapper launchers (gradle/wrapper/ holds the jar + properties)
└─ src/main/
   ├─ java/com/example/rubymod/
   │  ├─ RubyMod.java                    ← MAIN ENTRYPOINT (named in fabric.mod.json): implements ModInitializer, onInitialize() registers items/blocks
   │  ├─ RubyModClient.java              ← Optional CLIENT entrypoint: ClientModInitializer for renderers/HUD/keybinds
   │  └─ mixin/                          ← @Mixin classes, e.g. mixin/ExampleMixin.java (listed in the mixin json)
   └─ resources/
      ├─ fabric.mod.json                 ← REQUIRED mod metadata: id, version, entrypoints.main, depends, "mixins": ["rubymod.mixins.json"]
      ├─ rubymod.mixins.json             ← Mixin config: package, compatibilityLevel (JAVA_21), "mixins"[] + "client"[] class lists
      ├─ assets/rubymod/
      │  ├─ lang/en_us.json              ← Display names, e.g. "item.rubymod.ruby": "Ruby"
      │  ├─ models/item/ruby.json        ← Item models (blocks additionally need blockstates/ + models/block/)
      │  ├─ textures/item/ruby.png       ← 16x16 textures (item/ and block/ subfolders)
      │  └─ sounds.json + sounds/…       ← Optional: custom sound events
      └─ data/rubymod/                   ← Optional data: recipes/, loot_tables/blocks/ (a block drops NOTHING without one), tags/…
\`\`\`

- Everything under src/main/resources ships inside the built jar; the gradle files stay outside.
- Loader pipeline: fabric.mod.json → instantiates entrypoints → onInitialize() registers content → assets/data load as data packs.`,

  forge: `Project layout for a new **Forge mod** (example mod id: \`rubymod\`, Java package: \`com.example.rubymod\`):

\`\`\`
myrubymod/
├─ build.gradle                          ← ForgeGradle 6 script: minecraft dependency, mappings channel "official", run configs
├─ gradle.properties                     ← Pins: minecraft_version, forge_version, mappings_channel=official, mappings_version, mod_id…
├─ settings.gradle                       ← Plugin repositories (MinecraftForge maven)
├─ gradlew + gradlew.bat                 ← Gradle wrapper launchers (gradle/wrapper/ holds the jar + properties)
└─ src/main/
   ├─ java/com/example/rubymod/
   │  ├─ RubyMod.java                    ← ENTRYPOINT: @Mod("rubymod") class — its constructor registers DeferredRegisters to the MOD event bus
   │  ├─ ModItems.java                   ← DeferredRegister<Item>(ForgeRegistries.ITEMS) + RegistryObject fields (DeferredRegister.Items on newer versions)
   │  ├─ ModBlocks.java                  ← DeferredRegister<Block>(ForgeRegistries.BLOCKS) + a BlockItem per block
   │  └─ mixin/                          ← @Mixin classes (wired via the mixin json, see below)
   └─ resources/
      ├─ META-INF/mods.toml              ← REQUIRED Forge metadata: modLoader="javafml", loaderVersion="[52,)", [[mods]], [[dependencies.rubymod]]
      ├─ pack.mcmeta                     ← Resource-pack descriptor — pack_format must match your MC version
      ├─ rubymod.mixins.json             ← Mixin config; referenced via the "MixinConfigs" jar-manifest attribute in build.gradle
      ├─ assets/rubymod/                 ← lang/, blockstates/, models/, textures/ (same layout as Fabric)
      └─ data/rubymod/                   ← recipes/, loot_tables/blocks/, tags/…
\`\`\`

- Everything under src/main/resources ships inside the built jar; the gradle files stay outside.
- Loader pipeline: mods.toml → @Mod constructor → DeferredRegister fires on the mod bus → registry objects resolve.`,

  neoforge: `Project layout for a new **NeoForge mod** (example mod id: \`rubymod\`, Java package: \`com.example.rubymod\`):

\`\`\`
myrubymod/
├─ build.gradle                          ← ModDevGradle (or NeoGradle) script: neoforge dependency + run configs
├─ gradle.properties                     ← Pins: minecraft_version, neoforge_version, mod_id, mod_version…
├─ settings.gradle                       ← Plugin repositories (NeoForged maven)
├─ gradlew + gradlew.bat                 ← Gradle wrapper launchers (gradle/wrapper/ holds the jar + properties)
└─ src/main/
   ├─ java/com/example/rubymod/
   │  ├─ RubyMod.java                    ← ENTRYPOINT: @Mod("rubymod") — its constructor registers DeferredRegisters to the mod event bus
   │  ├─ ModItems.java                   ← DeferredRegister.Items (NeoForge helper) + DeferredItem<Item> fields
   │  ├─ ModBlocks.java                  ← DeferredRegister.Blocks + DeferredBlock fields
   │  └─ mixin/                          ← @Mixin classes (wired via the mixin json, see below)
   └─ resources/
      ├─ META-INF/neoforge.mods.toml     ← REQUIRED NeoForge metadata: modLoader="javafml", loaderVersion="[21,)", [[mixins]], [[dependencies.rubymod]]
      ├─ pack.mcmeta                     ← Resource-pack descriptor (pack_format for your MC version)
      ├─ rubymod.mixins.json             ← Mixin config — listed in neoforge.mods.toml under [[mixins]] config = "rubymod.mixins.json"
      ├─ assets/rubymod/                 ← lang/, blockstates/, models/, textures/
      └─ data/rubymod/                   ← recipes/, loot_tables/, tags/ (plus NeoForge extras like data maps)
\`\`\`

- Everything under src/main/resources ships inside the built jar; the gradle files stay outside.
- Loader pipeline: neoforge.mods.toml → @Mod constructor → DeferredRegister fires on the mod bus → registry objects resolve.`,
}

function toolModProjectLayout(loader: string): string {
  return MOD_TREES[loader]
}

/* ------------------------------------------------------------------ */
/* Tool 3: shader_pack_layout                                          */
/* ------------------------------------------------------------------ */

const SHADER_PACK_LAYOUT = `File layout of an **OptiFine / Iris shader pack**:

\`\`\`
myshaderpack/                            ← the pack root (folder or .zip) — goes in .minecraft/shaderpacks/
└─ shaders/                              ← EVERYTHING the shader loader reads lives under here
   ├─ shaders.properties                 ← Pack config: option screens, profiles, sliders, shadow settings, custom uniforms
   ├─ lib/                               ← Shared GLSL snippets, included with #include "/lib/….glsl" (paths start at shaders/)
   │  ├─ common.glsl                     ← e.g. tonemap/saturation helpers, noise functions
   │  └─ shadow_distort.glsl             ← Depth distortion for the shadow map (reduces near-camera aliasing)
   ├─ shadow.vsh + shadow.fsh            ← SHADOW PASS: re-renders the world from the sun into the shadow map
   ├─ gbuffers_terrain.vsh + .fsh        ← Geometry pass: solid + cutout terrain (stone, dirt, leaves…)
   ├─ gbuffers_textured.vsh + .fsh       ← Geometry pass: unlit textured quads (particles, signs, banners)
   ├─ gbuffers_textured_lit.vsh + .fsh   ← Geometry pass: like gbuffers_textured but multiplied by the lightmap
   ├─ gbuffers_entities.vsh + .fsh       ← Geometry pass: entities, armor, held items (entityColor uniform = hurt flash)
   ├─ gbuffers_water.vsh + .fsh          ← Geometry pass: translucents — water, stained glass, nether portal
   ├─ gbuffers_skybasic.vsh + .fsh       ← Geometry pass: sky gradient/horizon (plain color, no texture)
   ├─ gbuffers_skytextured.vsh + .fsh    ← Geometry pass: sun, moon, stars (textured)
   ├─ composite.vsh + composite.fsh      ← POST pass 0: full-screen quad over the scene — shadows + lighting usually land here
   ├─ composite1.vsh + composite1.fsh    ← POST pass 1 … (you can keep going up to composite15)
   ├─ final.vsh + final.fsh              ← LAST pass, writes to the screen: tonemap, vignette, FXAA, letterbox…
   └─ world-1/                           ← Optional per-dimension program overrides (world-1 = nether, world1 = end)
\`\`\`

How Iris / OptiFine load it:
- Drop the pack (folder or zip) into \`.minecraft/shaderpacks/\`, then enable it in OptiFine (Video Settings → Shaders…) or Iris (Video Settings → Shader Packs…).
- Programs are discovered purely by FILENAME CONVENTION — the same names work in OptiFine and Iris. One program = a matching .vsh (vertex) + .fsh (fragment) pair; a lone file is ignored.
- Draw order: shadow pass → gbuffers_* (each vanilla render layer looks up its program by name) → composite, composite1, composite2… in numeric order → final.
- Missing programs silently fall back to a built-in default — a valid pack can be as small as composite.fsh + final.fsh.
- \`#include "/lib/x.glsl"\` paths are absolute from the shaders/ folder; includes are stitched in before compiling.
- shaders.properties declares the pack's options: \`screen.SHADOW=…\`, \`sliders=…\`, \`profile.LOW=…\`, \`shadowMapResolution=2048\`, \`shadowDistance=160\`, custom uniforms via \`uniform.float.<name>=…\`.`

function toolShaderPackLayout(): string {
  return SHADER_PACK_LAYOUT
}

/* ------------------------------------------------------------------ */
/* Tool 4: search_wiki                                                 */
/* ------------------------------------------------------------------ */

interface WikiEntry {
  title: string
  keywords: string[]
  body: string
}

const WIKI: WikiEntry[] = [
  {
    title: 'Registering items',
    keywords: ['item', 'items', 'register', 'registry', 'registration', 'new item'],
    body: 'Fabric: `Registry.register(Registries.ITEM, Identifier.of("rubymod", "ruby"), new Item(new Item.Settings()))` inside onInitialize(). Forge: `DeferredRegister<Item> ITEMS = DeferredRegister.create(ForgeRegistries.ITEMS, MODID)` + `ITEMS.register("ruby", () -> new Item(props))`, registered to the mod bus in the @Mod constructor. NeoForge: `DeferredRegister.Items ITEMS = DeferredRegister.createItems(MODID)` + `ITEMS.registerSimpleItem("ruby", props)`. After registering: model JSON at assets/modid/models/item/ruby.json, texture at textures/item/ruby.png, lang key `item.modid.ruby`.',
  },
  {
    title: 'Registering blocks',
    keywords: ['block', 'blocks', 'register', 'registry', 'registration', 'blockitem', 'new block'],
    body: 'Fabric: `Registry.register(Registries.BLOCK, id, new Block(AbstractBlock.Settings.create().strength(1.5f)))` — also register a BlockItem with the same id or it will not appear in the inventory. Forge/NeoForge: DeferredRegister.Blocks. A block also needs: blockstate JSON (assets/modid/blockstates/<id>.json), block model, loot table (data/modid/loot_tables/blocks/<id>.json — without it the block drops nothing).',
  },
  {
    title: 'Mixins',
    keywords: ['mixin', 'mixins', 'inject', 'redirect', 'overwrite', 'mixin json', 'hook'],
    body: 'Mixins inject code into vanilla classes at class-load time. Config file `modid.mixins.json` declares: package, compatibilityLevel (JAVA_17/JAVA_21), `mixins` (common) and `client` class lists. Wiring: Fabric → `"mixins": [...]` in fabric.mod.json; NeoForge → `[[mixins]] config = "..."` in neoforge.mods.toml; Forge → "MixinConfigs" jar-manifest attribute in build.gradle. A mixin class: `@Mixin(Target.class)` with `@Inject(method = "...", at = @At("..."))` — prefer @Inject / @Redirect / @ModifyArg over @Overwrite.',
  },
  {
    title: 'Data generation (datagen)',
    keywords: ['datagen', 'data generation', 'provider', 'providers', 'recipe', 'recipes', 'loot table', 'loot tables', 'model provider', 'tags'],
    body: 'Datagen writes your JSON assets/data from code, so you never hand-write models/recipes/loot/lang. Run via `gradlew runDatagen` (Fabric/NeoForge) or `gradlew runData` (Forge). Providers: blockstate + item model provider, RecipeProvider, block loot provider, TagProvider, LangProvider. Fabric: implement `DataProvider` and hook the `fabric-datagen` entrypoint → onInitializeDataGenerator.',
  },
  {
    title: 'Creative tabs / item groups',
    keywords: ['creative tab', 'creative tabs', 'creative mode tab', 'itemgroup', 'item group', 'itemgroups'],
    body: 'Fabric 1.19.3+: `FabricItemGroup.builder().icon(() -> new ItemStack(RUBY)).displayName(Text.literal("Ruby")).entries((ctx, out) -> out.accept(RUBY)).build()` registered in Registries.ITEM_GROUP. Forge/NeoForge: `DeferredRegister<CreativeModeTab>` with `CreativeModeTab.builder().icon(...).title(...).displayItems((params, output) -> output.accept(RUBY)).build()`, registered to the mod bus. You can also append to a vanilla tab via its BuildCreativeModeTabContentsEvent.',
  },
  {
    title: 'gbuffers_* geometry programs',
    keywords: ['gbuffers', 'gbuffers_textured', 'gbuffers_terrain', 'gbuffers_water', 'gbuffers_entities', 'gbuffer', 'geometry', 'render pass'],
    body: 'gbuffers_* are the geometry passes — programs that draw the actual world. Each is a matching .vsh/.fsh pair, selected by filename. Main ones: gbuffers_terrain (solid + cutout blocks), gbuffers_entities (mobs/armor/held items), gbuffers_water (translucents), gbuffers_textured (unlit quads: particles, signs), gbuffers_textured_lit (same but lightmapped), gbuffers_skybasic/skytextured (sky). Available built-in uniforms differ per pass (lightmap in *_lit, entityColor in entities). Missing programs fall back to defaults.',
  },
  {
    title: 'The shadow pass',
    keywords: ['shadow', 'shadows', 'shadow pass', 'shadowmap', 'shadow map', 'shadowtex', 'shadow distance'],
    body: 'shadow.vsh/.fsh re-renders the scene from the sun into the shadow map (shadowtex0/shadowtex1 + shadowcolor). Configure with `shadowMapResolution` (default 2048) and `shadowDistance` in shaders.properties. Sample the shadow map later in composite via the `shadow` sampler, projecting through shadow-space (a distort() function on shadow-space position reduces near-camera aliasing). Only geometry rendered by the shadow program lands in the map — cull plants etc. via checks like `mc_Entity.x`.',
  },
  {
    title: 'Shader uniforms & samplers',
    keywords: ['uniform', 'uniforms', 'sampler', 'samplers', 'gbuffermodelview', 'frametimecounter', 'variables'],
    body: 'Uniforms are the values Minecraft feeds each program: `uniform mat4 gbufferModelView; uniform vec3 cameraPosition; uniform float frameTimeCounter; uniform sampler2D gtexture;`. Sampler names differ slightly between OptiFine (`texture`) and Iris (`gtexture`) — Iris aliases both. Custom uniforms/options are declared in shaders.properties (`uniform.float.myValue=1.0`, `variable.float.x=…`) and then usable like built-ins.',
  },
  {
    title: 'shaders.properties',
    keywords: ['shaders.properties', 'shader options', 'options screen', 'profile', 'profiles', 'sliders', 'screen'],
    body: 'shaders.properties (in shaders/) configures the pack. Common keys: `shadowMapResolution=2048`, `shadowDistance=160`, option screens (`screen.SHADOW=shadowDistance shadowMapResolution [WORLD]`), `sliders=shadowDistance SHADOW_SOFTNESS`, profiles (`profile.LOW=shadowMapResolution=1024`), custom uniforms (`uniform.float.sunPathRotation=-40.0`). Plain key=value lines, `#` comments. Both OptiFine and Iris read it.',
  },
  {
    title: 'fabric.mod.json & entrypoints',
    keywords: ['fabric.mod.json', 'entrypoint', 'entrypoints', 'modinitializer', 'clientmodinitializer', 'mod metadata', 'manifest'],
    body: 'fabric.mod.json is the Fabric mod manifest (src/main/resources/fabric.mod.json). Key fields: `id` (lowercase, ≤64 chars), `version`, `entrypoints` — main: [ModInitializer] for content, client: [ClientModInitializer] for rendering/HUD — plus `mixins` (mixin json list) and `depends` (fabricloader, minecraft, java, fabric-api). Entrypoints are instantiated at launch; content registration happens in onInitialize().',
  },
]

function toolSearchWiki(query: string): string {
  const q = query.toLowerCase().trim()
  const tokens = q.split(/[^a-z0-9_.+]+/).filter((t) => t.length >= 2)

  const scored = WIKI.map((entry) => {
    let score = 0
    for (const kw of entry.keywords) {
      if (q === kw) score += 6
      else if (tokens.some((t) => t === kw)) score += 4
      else if (q.includes(kw)) score += 3
      else if (tokens.some((t) => kw.includes(t) && t.length >= 3)) score += 1
    }
    return { entry, score }
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)

  if (!scored.length) {
    return (
      `No wiki entry matched "${query}" — try: registry, item, block, mixin, datagen, ` +
      'creative tab, shadow pass, gbuffers, uniforms, shaders.properties, fabric.mod.json entrypoints…'
    )
  }

  const top = scored.slice(0, 3)
  const header = `Wiki results for "${query}" (${top.length} ${top.length === 1 ? 'entry' : 'entries'}):`
  return header + '\n\n' + top.map((s, i) => `### ${i + 1}. ${s.entry.title}\n${s.entry.body}`).join('\n\n')
}

/* ------------------------------------------------------------------ */
/* Tool metadata (tools/list)                                          */
/* ------------------------------------------------------------------ */

const TOOLS = [
  {
    name: 'lookup_versions',
    description:
      'Get recommended toolchain pins for a Minecraft mod project: mod loader version (Fabric Loader / Forge / NeoForge), API version (Fabric API), mappings (Yarn / Mojang official) and required Java version, for a given Minecraft version. Built-in data for 1.21.1, 1.20.4, 1.20.1 and 1.19.2; unknown versions fall back to the 1.21.1 numbers with a note.',
    inputSchema: {
      type: 'object',
      properties: {
        loader: {
          type: 'string',
          enum: ['fabric', 'forge', 'neoforge'],
          description: 'Which mod loader to target.',
        },
        minecraft_version: {
          type: 'string',
          description: 'Minecraft version, e.g. "1.21.1" (default). Known: 1.21.1, 1.20.4, 1.20.1, 1.19.2.',
        },
      },
      required: ['loader'],
    },
  },
  {
    name: 'mod_project_layout',
    description:
      'Get the complete, correct file tree for starting a NEW Minecraft mod for a given loader (fabric, forge or neoforge): gradle files, mod metadata (fabric.mod.json / mods.toml / neoforge.mods.toml), entrypoint source, mixin config and assets/data folders — with a one-line note per file.',
    inputSchema: {
      type: 'object',
      properties: {
        loader: {
          type: 'string',
          enum: ['fabric', 'forge', 'neoforge'],
          description: 'Which mod loader to target.',
        },
      },
      required: ['loader'],
    },
  },
  {
    name: 'shader_pack_layout',
    description:
      'Get the correct file layout of an OptiFine/Iris-compatible Minecraft shader pack: shaders/shaders.properties, gbuffers_* geometry passes, composite/final post-processing stages, the shadow pass and /lib includes — with short notes on each stage and how Iris and OptiFine discover and load the files.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_wiki',
    description:
      'Search a small built-in Minecraft modding + shader knowledge base (item/block registration, mixins, datagen, creative tabs, fabric.mod.json entrypoints, gbuffers programs, shadow pass, uniforms, shaders.properties). Case-insensitive keyword search; returns the best 1–3 entries.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look for, e.g. "how to register an item" or "shadow map".',
        },
      },
      required: ['query'],
    },
  },
]

/* ------------------------------------------------------------------ */
/* JSON-RPC dispatch                                                   */
/* ------------------------------------------------------------------ */

interface RpcReply {
  jsonrpc: '2.0'
  id: unknown
  result?: unknown
  error?: { code: number; message: string }
}

function handleMessage(msg: Record<string, unknown>): RpcReply | null {
  const id = msg.id
  const isNotification = id === undefined || id === null
  const method = typeof msg.method === 'string' ? msg.method : ''

  // JSON-RPC notifications never get a response body -> 202 at the transport layer.
  if (isNotification) return null

  const ok = (result: unknown): RpcReply => ({ jsonrpc: '2.0', id, result })
  const err = (code: number, message: string): RpcReply => ({ jsonrpc: '2.0', id, error: { code, message } })

  switch (method) {
    case 'initialize': {
      const params = (msg.params ?? {}) as Record<string, unknown>
      const requested =
        typeof params.protocolVersion === 'string' && params.protocolVersion
          ? params.protocolVersion
          : FALLBACK_PROTOCOL_VERSION
      return ok({
        protocolVersion: requested,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'MineForge demo MCP server. Minecraft-flavored read-only tools: lookup_versions (toolchain pins), ' +
          'mod_project_layout (new-mod file trees), shader_pack_layout (Iris/OptiFine pack structure), ' +
          'search_wiki (modding + shader knowledge base).',
      })
    }

    case 'notifications/initialized':
      // Spec-wise a notification; if a client sends it WITH an id, ack politely.
      return ok({})

    case 'ping':
      return ok({})

    case 'tools/list':
      return ok({ tools: TOOLS })

    case 'tools/call':
      return handleToolsCall(msg, ok, err)

    default:
      return err(-32601, `Method not found: ${method || '(empty method)'}`)
  }
}

function handleToolsCall(
  msg: Record<string, unknown>,
  ok: (r: unknown) => RpcReply,
  err: (code: number, m: string) => RpcReply
): RpcReply {
  const params = (msg.params ?? {}) as Record<string, unknown>
  const name = params.name
  const args = params.arguments ?? {}

  if (typeof name !== 'string' || !name) {
    return err(-32602, 'Invalid params: tools/call requires { name: string, arguments?: object }')
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return err(-32602, `Invalid params for tool "${name}": arguments must be an object`)
  }

  const text = (t: string): RpcReply => ok({ content: [{ type: 'text', text: t }] })
  const invalid = (m: string): RpcReply => err(-32602, m)

  switch (name) {
    case 'lookup_versions': {
      const loader = args.loader
      if (typeof loader !== 'string' || !LOADERS.includes(loader)) {
        return invalid('Invalid params: `loader` is required and must be one of: fabric, forge, neoforge')
      }
      return text(toolLookupVersions(loader, args.minecraft_version))
    }
    case 'mod_project_layout': {
      const loader = args.loader
      if (typeof loader !== 'string' || !LOADERS.includes(loader)) {
        return invalid('Invalid params: `loader` is required and must be one of: fabric, forge, neoforge')
      }
      return text(toolModProjectLayout(loader))
    }
    case 'shader_pack_layout':
      return text(toolShaderPackLayout())
    case 'search_wiki': {
      if (typeof args.query !== 'string' || !args.query.trim()) {
        return invalid('Invalid params: `query` (string) is required')
      }
      return text(toolSearchWiki(args.query))
    }
    default:
      return err(-32602, `Unknown tool: ${name}. Available tools: ${TOOLS.map((t) => t.name).join(', ')}`)
  }
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */

async function handlePost(req: Request): Promise<Response> {
  let parsed: unknown
  try {
    parsed = await req.json()
  } catch {
    return jsonResponse(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: body must be JSON-RPC 2.0' } },
      400
    )
  }

  const isBatch = Array.isArray(parsed)
  const messages = (isBatch ? parsed : [parsed]).filter(
    (m): m is Record<string, unknown> => !!m && typeof m === 'object' && !Array.isArray(m)
  )

  if (!messages.length) {
    return jsonResponse(
      { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: expected a JSON-RPC 2.0 message' } },
      400
    )
  }

  const replies: RpcReply[] = []
  let sawNotification = false
  let sawInitialize = false

  for (const msg of messages) {
    if (msg.id != null && msg.method === 'initialize') sawInitialize = true
    const reply = handleMessage(msg)
    if (reply === null) sawNotification = true
    else replies.push(reply)
  }

  const headers = sessionHeaders(req, sawInitialize)

  // Single notification -> 202 + EMPTY body (never 200 with JSON).
  if (!isBatch) return sawNotification && replies.length === 0 ? accepted() : jsonResponse(replies[0], 200, headers)
  // Batch: all notifications -> 202; otherwise reply with an array of responses.
  if (replies.length === 0) return accepted()
  return jsonResponse(replies, 200, headers)
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const path = new URL(req.url).pathname

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (path !== '/mcp') {
      return jsonResponse(
        { error: 'Not found', hint: 'This demo MCP server exposes a single endpoint: POST /mcp' },
        404
      )
    }

    if (req.method !== 'POST') {
      // GET /mcp (and DELETE etc.) -> 405: only POST carries JSON-RPC messages.
      return jsonResponse(
        { error: 'Method not allowed', hint: 'POST JSON-RPC 2.0 messages to /mcp' },
        405,
        { allow: 'POST, OPTIONS' }
      )
    }

    return handlePost(req)
  },
})

console.log(`[mcp-demo] mineforge-demo-mcp v${SERVER_INFO.version} listening on http://localhost:${PORT}/mcp`)
console.log(`[mcp-demo] tools: ${TOOLS.map((t) => t.name).join(', ')}`)
