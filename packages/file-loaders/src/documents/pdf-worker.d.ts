// PDF.js does not publish declarations for this worker entry. Its handler is
// passed opaquely to PDF.js, which owns the worker protocol and calls its methods.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}
