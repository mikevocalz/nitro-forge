import type { Studio } from '@nitro-forge/studio-layout';

export const APP_MANIFESTS: Record<Studio, { task: string; detail: string; glyph: string; category: string }> = {
  quill: { task: 'Write a document', detail: 'Type an essay, work on a draft, or open a Word document.', glyph: 'text', category: 'Writing' },
  prism: { task: 'Create an image', detail: 'Work with image layers, shapes and artwork.', glyph: 'brush', category: 'Image & vector' },
  tally: { task: 'Open a spreadsheet', detail: 'Organize figures, formulas and sheets.', glyph: 'table', category: 'Spreadsheets' },
  pitch: { task: 'Build a presentation', detail: 'Arrange slides, text and visual elements.', glyph: 'slide', category: 'Presentations' },
  folio: { task: 'Work with a PDF', detail: 'Inspect pages, rotate and annotate a document.', glyph: 'pdf', category: 'PDF documents' },
  splice: { task: 'Edit a video timeline', detail: 'Arrange sources, clips and timing.', glyph: 'scissors', category: 'Video' },
  cadence: { task: 'Make an audio project', detail: 'Work with tracks, notes and arrangements.', glyph: 'music', category: 'Audio' },
  photo: { task: 'Organize a photo catalog', detail: 'Rate originals, manage versions and preview develop recipes.', glyph: 'image', category: 'Photography' },
  motion: { task: 'Build a motion composition', detail: 'Animate layers, evaluate frames and render previews.', glyph: 'play', category: 'Motion' },
  design: { task: 'Design an interface', detail: 'Arrange frames, text and components on a canvas.', glyph: 'color-wheel', category: 'Design' },
  draft: { task: 'Draw a CAD document', detail: 'Draft geometry, constraints and paper-space sheets.', glyph: 'pencil', category: 'CAD drafting' },
};

