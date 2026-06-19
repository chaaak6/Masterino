import { pathToFileURL } from 'node:url';

export const filePathToAppUrl = (filePath: string) => {
  return `app://masterlion.local${pathToFileURL(filePath).pathname}`;
};
