import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { writeFileSync, readdirSync, mkdirSync } from 'fs';
import { join, extname, basename } from 'path';

const imageDir = '.';
const preprocessDir = './preprocessed';
const outputFile = 'ocr-results.txt';

const imageFiles = readdirSync(imageDir).filter(f =>
  ['.jpg', '.jpeg', '.png', '.bmp', '.tiff'].includes(extname(f).toLowerCase())
);

if (imageFiles.length === 0) {
  console.log('No image files found.');
  process.exit(1);
}

mkdirSync(preprocessDir, { recursive: true });

console.log(`Found ${imageFiles.length} image(s): ${imageFiles.join(', ')}\n`);

async function preprocess(inputPath) {
  const outPath = join(preprocessDir, basename(inputPath, extname(inputPath)) + '.png');
  await sharp(inputPath)
    .resize({ width: 2000, withoutEnlargement: false }) // upscale for better OCR resolution
    .greyscale()
    .normalise()                                         // auto-stretch contrast
    .sharpen()
    .png()
    .toFile(outPath);
  return outPath;
}

// PSM 6=block, 7=single line, 8=single word, 13=raw line
const psmModes = [
  { psm: '6', label: 'PSM 6 (block)' },
  { psm: '7', label: 'PSM 7 (single line)' },
  { psm: '8', label: 'PSM 8 (single word)' },
  { psm: '13', label: 'PSM 13 (raw line)' },
];

const lines = [];

for (const file of imageFiles) {
  const filePath = join(imageDir, file);
  console.log(`Pre-processing: ${file} ...`);
  const preprocessedPath = await preprocess(filePath);

  let best = null;

  for (const { psm, label } of psmModes) {
    process.stdout.write(`  Running OCR [${label}] ...`);

    const worker = await createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          process.stdout.write(`\r  Running OCR [${label}] ${(m.progress * 100).toFixed(0)}%  `);
        }
      },
    });

    await worker.setParameters({
      tessedit_char_whitelist: '0123456789',
      tessedit_pageseg_mode: psm,
    });

    const { data } = await worker.recognize(preprocessedPath);
    await worker.terminate();

    const text = data.text.trim();
    console.log(`\n    Confidence: ${data.confidence.toFixed(1)}%  Text: "${text}"`);

    if (!best || data.confidence > best.confidence) {
      best = { psm: label, confidence: data.confidence, text };
    }
  }

  console.log(`\n  Best result for ${file}: [${best.psm}] "${best.text}" (${best.confidence.toFixed(1)}%)\n`);

  lines.push(`=== ${file} ===`);
  lines.push(`Best PSM: ${best.psm}`);
  lines.push(`Confidence: ${best.confidence.toFixed(1)}%`);
  lines.push(`Text: ${best.text}`);
  lines.push('');
}

writeFileSync(outputFile, lines.join('\n'), 'utf8');
console.log(`Results written to ${outputFile}`);
