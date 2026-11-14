export type ImageSize = { width: number; height: number };

/** A CV photo in the 3x4 portrait ratio. */
export const PHOTO_SIZE: ImageSize = { width: 300, height: 400 };
export const AVATAR_SIZE: ImageSize = { width: 256, height: 256 };

// The API refuses longer data URLs (MAX_IMAGE_DATA_URL in backend/src/cvData.ts).
const MAX_DATA_URL_LENGTH = 300_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Crops the picture to fill `size` and compresses it to a small JPEG data URL, so a photo can be
 * stored with the CV or profile and printed without any separate file storage.
 */
export async function imageFileToDataUrl(file: File, size: ImageSize): Promise<string> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error("Chỉ nhận ảnh JPG, PNG hoặc WebP.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Ảnh tối đa 10 MB.");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Không đọc được ảnh này. Hãy chọn ảnh khác.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Trình duyệt không xử lý được ảnh.");
  }
  // Cover the frame. A tall picture keeps more of its top, where the face usually is.
  const scale = Math.max(size.width / bitmap.width, size.height / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(bitmap, (size.width - width) / 2, (size.height - height) * 0.3, width, height);
  bitmap.close();
  for (const quality of [0.86, 0.72, 0.58]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_DATA_URL_LENGTH) return url;
  }
  throw new Error("Ảnh quá chi tiết để nén vừa giới hạn. Hãy chọn ảnh khác.");
}
