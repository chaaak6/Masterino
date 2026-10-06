// Office operations use the same execution-boundary path checks as other local files.
export type { CreateSpreadsheetParams, OfficeReadParams } from '@lobechat/file-loaders';
export type { OfficeBatchParams, OfficeTemplateParams } from '@lobechat/file-loaders';
export type {
  CreatePresentationParams,
  InspectPresentationParams,
  RenderPresentationPreviewParams,
  RevisePresentationParams,
  ValidatePresentationParams,
} from '@lobechat/file-loaders';
export {
  createOfficeDocument,
  createPresentation,
  inspectOfficeDocument,
  inspectPresentation,
  readOfficeDocument,
  renderPresentationPreview,
  revisePresentation,
  validatePresentation,
} from '@lobechat/file-loaders';
export {
  batchOfficeDocument,
  mergeOfficeTemplate,
  validateOfficeDocument,
} from '@lobechat/file-loaders';
