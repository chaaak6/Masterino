---
name: office-documents
description: Read, inspect and work with Word (.docx), Excel (.xlsx), and PowerPoint (.pptx) in the current execution environment. Prefer bounded structure and range tools; create documents only with capabilities actually available in that environment.
---

# Office Documents

Use the tools available in the current execution environment. Keep source files, scripts and outputs in that same environment. Do not activate the cloud sandbox to process a local document.

## Local documents

Use `lobe-local-system` tools. Start with `inspectOfficeDocument` for a bounded sample and worksheet names, or call `readOfficeDocument` directly when the requested location is known. The read tool uses one-based `start` and `limit` for rows, paragraphs or slides. Excel selects `sheet` by name; PowerPoint follows presentation order, not filenames. Word returns paragraphs and heading styles. These are structural/text results, not visual previews.

Results include `version`, `actualRange`, `total` (possibly unknown), `hasMore` and continuation `next`. Pass the returned version for follow-up reads; inspect again if the file changed. Never describe a bounded sample as the complete document. A large first read may scan the worksheet and shared strings on disk; it does not inject the complete file into the model. For numeric Excel summaries use `aggregateColumn` (column letter, e.g. `B`) to calculate count/sum/min/max locally; add `groupByColumn` for grouped summaries. Formula results are cached values; the local reader does not recalculate formulas. Dates may be Excel serial values.

Local `createOfficeDocument` creates simple `.xlsx` files using `sheets` (names and literal cell rows), `.docx` using `paragraphs` (text and optional heading), or `.pptx` using `slides` (title and body text). These offline engines provide finite text-only creation, with independent text/order readback for Word and PowerPoint. It validates the generated package before publishing a new file and refuses to overwrite an existing destination. `batchOfficeDocument` edits literal cells and `mergeOfficeTemplate` replaces `{{key}}` text placeholders into a new workbook; both preserve the source, reject unsupported complex workbook features, and retain untouched formulas without recalculating. `validateOfficeDocument` checks supported xlsx structure. These tools do not support arbitrary formatting, macros, editing existing `.docx`/`.pptx`, screenshots or Office formula recalculation. Use same-environment code execution for additional work only after checking an appropriate engine is actually installed. Never claim support based on a cloud tool or install an engine implicitly.

Use real paths granted by the current workspace or prepared attachment. Save outputs to the authorized working directory, using a new filename for source-document transformations. Return the generated file path. Do not assume `/mnt/data` or `/tmp/masterino-office` exists locally.

## Cloud OfficeCLI documents

When the bound environment supplies OfficeCLI 1.0.143 tools, read one format guide before creating content: `references/word`, `references/excel`, or `references/powerpoint`. Use dedicated create/merge/batch tools, then inspect outline and issues, perform screenshot QA when supported, and validate before export. A structural validation result is not visual QA. The cloud OfficeCLI workflow uses `/tmp/masterino-office` for outputs and `/mnt/data` for prepared inputs. Never modify an uploaded original.

Do not run OfficeCLI through shell, update it at runtime, or assume the local implementation has the same capabilities. Avoid macros, external resources and legacy `.doc/.xls/.ppt`. Report unavailable capabilities explicitly and keep any fallback in the same execution environment.
