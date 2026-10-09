// The same limits the server enforces, checked first so people are told straight away.
export const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';
const MAX_BYTES = 2 * 1024 * 1024;

/** A message explaining what is wrong with the chosen files, or '' if they are fine. */
export function imageProblem(files) {
  if (files.length > 3) return 'Choose at most 3 images at a time.';
  const wrong = files.find((f) => !IMAGE_TYPES.split(',').includes(f.type));
  if (wrong) return `${wrong.name} is not a PNG, JPEG, GIF or WebP image.`;
  const big = files.find((f) => f.size > MAX_BYTES);
  if (big) return `${big.name} is larger than 2 MB.`;
  return '';
}
