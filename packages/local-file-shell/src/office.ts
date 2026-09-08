// Office operations use the same execution-boundary path checks as other local files.
export {
  createOfficeDocument,
  inspectOfficeDocument,
  readOfficeDocument,
} from '@lobechat/file-loaders';
export type { CreateSpreadsheetParams, OfficeReadParams } from '@lobechat/file-loaders';

export {
  batchOfficeDocument,
  mergeOfficeTemplate,
  validateOfficeDocument,
} from '@lobechat/file-loaders';
export type { OfficeBatchParams, OfficeTemplateParams } from '@lobechat/file-loaders';
