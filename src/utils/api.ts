/**
 * Safe API and JSON response handler with Serverless In-Browser Engine & Fallback
 */
import { executeServerlessApi } from '../services/serverlessEngine';

export interface ApiErrorDetails {
  status?: number;
  message: string;
  isCloudflare?: boolean;
}

/**
 * Fetch and safely parse JSON response.
 * Automatically handles /api requests using the zero-server serverless engine,
 * and fetches static files (like /assets/...) using standard fetch.
 */
export async function fetchJson<T = any>(url: string, options?: RequestInit): Promise<T> {
  // If request is an /api call, route directly through the client-side serverless engine
  if (url.startsWith('/api/') || url === '/api') {
    try {
      return await executeServerlessApi(url, options);
    } catch (err: any) {
      console.warn(`[Serverless Engine] Error on ${url}:`, err);
      throw new Error(err.message || 'செயல்பாட்டில் பிழை ஏற்பட்டது.');
    }
  }

  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (networkErr: any) {
    console.error(`Network fetch failed for ${url}:`, networkErr);
    throw new Error(
      `இணைப்பு பிழை (Connection Error): ${networkErr.message || 'Failed to load file.'}`
    );
  }

  const contentType = res.headers.get('content-type') || '';
  let rawText = '';
  try {
    rawText = await res.text();
  } catch (readErr: any) {
    console.warn(`Failed to read response stream for ${url}:`, readErr);
    rawText = '';
  }

  // Try parsing JSON if content exists
  let data: any = null;
  const trimmed = rawText.trim();
  if (trimmed.length > 0) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      data = null;
    }
  }

  const isHtml =
    contentType.includes('text/html') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('<head>');

  if (!res.ok) {
    if (data && typeof data === 'object' && (data.error || data.message)) {
      throw new Error(data.error || data.message);
    }
    if (isHtml) {
      throw new Error(`கோப்பு கிடைக்கவில்லை (File Not Found: ${url}).`);
    }
    throw new Error(`பிழை (${res.status}): ${rawText.slice(0, 150) || 'Unknown response'}`);
  }

  if (data === null) {
    if (!trimmed) {
      return {} as T;
    }
    if (isHtml) {
      throw new Error(`கோப்பு கிடைக்கவில்லை அல்லது தவறான வடிவம் (Invalid format).`);
    }
    throw new Error(`செல்லுபடியாகாத பதில் வந்தது.`);
  }

  return data as T;
}

/**
 * Compress and optimize uploaded photo/image before sending over network.
 * Resizes 10-20MB mobile camera photos down to max 1600px width/height and 85% JPEG quality (~150-300KB),
 * preventing memory bloat while preserving crisp text OCR readability for Gemini AI.
 */
export function compressImageFile(
  file: File,
  maxDimension = 1600,
  quality = 0.85
): Promise<{ id: string; name: string; size: string; base64: string }> {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calculate proportional scale
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          const base64Length = compressedBase64.length - (compressedBase64.indexOf(',') + 1);
          const byteLength = (base64Length * 3) / 4;

          const sizeFormatted =
            byteLength < 1024 * 1024
              ? `${(byteLength / 1024).toFixed(1)} KB`
              : `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;

          resolve({
            id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            name: file.name,
            size: sizeFormatted,
            base64: compressedBase64,
          });
          return;
        }

        // Fallback if canvas context fails
        const fallbackSize =
          file.size < 1024 * 1024
            ? `${(file.size / 1024).toFixed(1)} KB`
            : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

        resolve({
          id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size: fallbackSize,
          base64: event.target?.result as string,
        });
      };

      img.onerror = () => {
        const fallbackSize =
          file.size < 1024 * 1024
            ? `${(file.size / 1024).toFixed(1)} KB`
            : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;

        resolve({
          id: `img-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size: fallbackSize,
          base64: event.target?.result as string,
        });
      };

      img.src = event.target?.result as string;
    };

    reader.readAsDataURL(file);
  });
}
