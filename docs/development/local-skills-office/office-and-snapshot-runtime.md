# Office and project Skill runtime implementation

## Office engine evidence

- Reads reuse installed yauzl ZIP streams. XLSX worksheet rows and DOCX paragraphs are incrementally scanned; shared strings are disk indexed. PPTX reads presentation relationships before loading individual slides. No whole-workbook loader is used for bounded reads or grouped aggregation.
- Results have versions, actual ranges, bounded records, hasMore/next, and unknown totals when a scan stops early. A 16-entry bounded-result cache includes the version. Grouped numeric aggregates cap groups and result characters.
- XLSX writing uses the existing SheetJS 0.20.3 dependency. Literal cell edits/template merges publish a new file only; unchanged formulas are checked after writing. Modification rejects unsupported complex workbook parts and enforces compressed/expanded limits. Cached formula values are not recalculated; arbitrary formatting preservation is not promised.
- Simple text DOCX/PPTX creation uses pinned docx 9.7.1 and pptxgenjs 4.0.1. Both report MIT licenses in the published package metadata; docx declares Node >=10. Sources: https://www.npmjs.com/package/docx/v/9.7.1 and https://www.npmjs.com/package/pptxgenjs/v/4.0.1 . These are JavaScript dependencies bundled by the existing desktop build, with no runtime installation.
- DOCX/PPTX generation is independently read back through the ZIP reader for text and ordering before publishing. Visual layout remains unverified. Existing DOCX/PPTX editing, template merging, images, and arbitrary Office formatting are outside this finite writer.
- Same-filesystem temporary files are validated before exclusive hard-link publication; existing output names fail without replacing originals.
- Frozen offline install passed with the minimal lockfile additions. Seven Office tests pass with one worker, including real XLSX/DOCX/PPTX generation, pagination, formulas, grouped sums, PPT order, and failed overwrite preservation. A standalone Office-only TypeScript check passed before the memory-related stop. Full desktop packaging and remote deployment acceptance are separate checks.

## Project Skill snapshots

The device RPC `prepareProjectSkillSnapshot` binds the existing skill key, operation ID, and canonical workspace to a persisted content-addressed resource directory. It copies regular nonhidden files, rejects symlinks/special files, enforces file/count/total limits, and compares source and copy digests before binding. Exclusive binding publication preserves the first winner even across host processes. Recreated runtimes resolve the same operation binding; a new operation captures current files.

Activation reads the snapshot body, reference reads use snapshot membership and the verified scanned bytes, and script execution resolves the snapshot directory. The script working directory stays the operation workspace and `SKILL_DIR` points to the verified prepared resources. Hashes are internal storage versions; registry keys remain the model-facing identity.

The existing device dispatcher, local gateway boundary, managed-cache realpath verifier, and server device RPC are reused. No new execution provider is introduced. The snapshot is not an OS process sandbox. Device tests verify same-operation body/reference/script consistency and next-operation refresh; 21 Skill runtime tests pass with one worker.

Resource snapshots enforce per-package limits; lifecycle cleanup of old operation receipts/cache directories remains a separate storage lifecycle concern. No clean installed Electron package or remote image verification is asserted by these unit/integration tests.

## User Skill versions and Web execution

User ZIP activation stores `resourceVersion` internally in plugin state and activation history. Execution requires that version to match both the operation registry and the current owned package; legacy activations without a version must reactivate. Desktop and server script adapters independently check the version before preparing a ZIP. Model-facing skill keys are unchanged.

The Web client ReAct executor now sends its persisted tool-message ID, topic ID, and API name to `market.executeSkillTool` for activation, reference reads, and scripts. The server verifies the owned topic, tool message, matching parent assistant call, and same-topic ancestor chain, then reads stored arguments. It reuses AiAgentService's existing execution-context and Skill-registry preparation and the formal server Skills runtime. The sandbox endpoint preserves the configured target before checking eligibility; device or disabled targets cannot silently fall back to cloud. Ordinary self-authored cloud scripts remain available through the existing generic sandbox endpoint, while unbound Skill ZIP arguments are rejected there.

Client operation IDs exist only in client state. This endpoint derives its operation scope from the owned ancestor user message and rechecks persisted current agent/workspace policy on each call. It does not treat a client registry as trusted frozen authorization. The client tool lifecycle already waits for tool-message persistence before execution. The relevant source path is client `conversationLifecycle` → `executeClientAgent` → `lobe-skills` executor; server-operated ReAct continues through the existing server runtime.

Targeted tests cover old and missing versions, current-version execution, adapter-side version races, disabled same-name skills, owned/cross-topic message evidence, device-target rejection, router delegation, and client forwarding. No actual system script is run by those tests. Real authenticated database requests and the new Web endpoint still require remote-image acceptance; mocked router middleware is not evidence of end-to-end authentication. Office and Electron end-to-end acceptance is tracked separately by the coordinating task.
