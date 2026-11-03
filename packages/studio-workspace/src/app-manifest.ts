import type { Studio } from '@nitro-forge/studio-layout';

export const APP_MANIFESTS: Record<Studio, { task: string; detail: string; glyph: string; category: string }> = {
  quill: { task: 'Write a document', detail: 'Type an essay, work on a draft, or open a Word document.', glyph: 'text', category: 'Writing' },
  prism: { task: 'Create an image', detail: 'Work with image layers, shapes and artwork.', glyph: 'brush', category: 'Image & vector' },
  tally: { task: 'Open a spreadsheet', detail: 'Organize figures, formulas and sheets.', glyph: 'table', category: 'Spreadsheets' },
  pitch: { task: 'Build a presentation', detail: 'Arrange slides, text and visual elements.', glyph: 'slide', category: 'Presentations' },
  folio: { task: 'Work with a PDF', detail: 'Inspect pages, rotate and annotate a document.', glyph: 'pdf', category: 'PDF documents' },
  splice: { task: 'Edit a video timeline', detail: 'Arrange sources, clips and timing.', glyph: 'scissors', category: 'Video' },
  cadence: { task: 'Make an audio project', detail: 'Work with tracks, notes and arrangements.', glyph: 'music', category: 'Audio' },
};

