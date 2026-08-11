/**
 * Client-side background removal for garment photo uploads.
 *
 * Runs @imgly/background-removal in a Web Worker (ONNX + WASM) before the
 * form submits, injecting the processed webp into a hidden nobgPhoto field.
 * On any failure the form submits unchanged — the server-side fallback path
 * handles generation lazily on first /file/nobg/ request.
 *
 * Models are served from /bg-removal-models/ (@imgly/background-removal-data
 * installed from the IMG.LY CDN tarball — no runtime CDN required).
 */

let activeProgressHandler = null;

export const isBgRemovalEnabled = () =>
  localStorage.getItem('bgRemovalEnabled') !== 'false';

const config = {
  publicPath: location.origin + '/bg-removal-models/',
  debug: true,
  // @imgly/background-removal handles graceful degradation to WASM if navigator.gpu WebGPU is unavailable
  // when set to 'gpu'.
  device: 'gpu',
  proxyToWorker: true,
  // Note when webgpu is used the 'isnet_quint8' 8bit floating point model gets converted at
  // runtime to fp16. Some overhead is incurred in this conversion step.
  model: 'isnet_quint8',
  // Can output to a given format. Notably though webp incurs
  // a compute burden on the client to convert in `imageEncode`.
  // Leave to the default 'image/png' to bypass this.
  // output: { format: 'image/webp', quality: 0.9 },
  // Stable callback required because init() is memoized by config shape.
  progress: (key, current, total) => {
    activeProgressHandler?.(key, current, total);
  },
};

const updateStatusText = (bgStatus, bgStatusText, key) => {
  if (!bgStatus || !bgStatusText) return;

  if (key.startsWith('fetch:') && bgStatus.dataset.textDownloading) {
    bgStatusText.textContent = bgStatus.dataset.textDownloading;
    return;
  }
  if (key === 'compute:decode' && bgStatus.dataset.textDecoding) {
    bgStatusText.textContent = bgStatus.dataset.textDecoding;
    return;
  }
  if (key === 'compute:inference' && bgStatus.dataset.textInference) {
    bgStatusText.textContent = bgStatus.dataset.textInference;
    return;
  }
  if (key === 'compute:mask' && bgStatus.dataset.textMask) {
    bgStatusText.textContent = bgStatus.dataset.textMask;
    return;
  }
  if (key === 'compute:encode' && bgStatus.dataset.textEncoding) {
    bgStatusText.textContent = bgStatus.dataset.textEncoding;
  }
};

/**
 * Centre-pads a Blob into a square PNG OffscreenCanvas blob.
 * This matches the layout produced during the initial upload so that
 * the mask editor's restore brush samples the correct pixel positions.
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
const squarePadBlob = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  const size = Math.max(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    bitmap,
    Math.floor((size - bitmap.width) / 2),
    Math.floor((size - bitmap.height) / 2),
  );
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
};

/**
 * Recentres the visible subject after background removal. The mask editor
 * deliberately operates on the untouched, square-padded result so its restore
 * brush remains aligned with the original. This runs only after editing, just
 * before upload, to give the wardrobe card a tighter and more balanced frame.
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
const centerAndCropTransparentBlob = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  const source = new OffscreenCanvas(bitmap.width, bitmap.height);
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  sourceCtx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const { data, width, height } = sourceCtx.getImageData(
    0,
    0,
    source.width,
    source.height,
  );
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  // Ignore near-transparent anti-aliased pixels when finding the subject.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  // Keep the original if background removal produced a fully transparent file.
  if (right < left || bottom < top) return blob;

  const subjectWidth = right - left + 1;
  const subjectHeight = bottom - top + 1;
  // Reserve 12% padding on each side around the subject in the final square.
  const outputSize = Math.ceil(Math.max(subjectWidth, subjectHeight) / 0.76);
  const cropCenterX = (left + right + 1) / 2;
  const cropCenterY = (top + bottom + 1) / 2;
  const cropLeft = cropCenterX - outputSize / 2;
  const cropTop = cropCenterY - outputSize / 2;
  const output = new OffscreenCanvas(outputSize, outputSize);
  output.getContext('2d').drawImage(source, -cropLeft, -cropTop, width, height);
  return output.convertToBlob({ type: 'image/webp', quality: 0.95 });
};

let mod = await import('/modules/background-removal/index.mjs');
let removeBackground = mod.removeBackground;

import { openMaskEditor } from '/js/mask-editor.js';

export const initBackgroundRemoval = async () => {
  try {
    mod.preload(config).then(() => {
      console.log('Asset preloading succeeded');
    });
  } catch (err) {
    // Package failed to load (old browser, no ES module support, etc.)
    // Leave the form as-is; server fallback will handle it.
    console.warn('[bg-removal] Failed to load background-removal module:', err);
    return;
  }
};

export const prepareBackgroundRemovedImage = async (file) => {
  const squareFile = await squarePadBlob(file);
  const rawBlob = await removeBackground(squareFile, config);
  const editedBlob = await openMaskEditor(squareFile, rawBlob);
  return centerAndCropTransparentBlob(editedBlob);
};

export const wireUpPhotoInput = async () => {
  const photoInput = document.getElementById('photoInput');
  const nobgInput = document.getElementById('nobgPhotoInput');
  const submitBtn = document.getElementById('photoBtn');
  const bgStatus = document.getElementById('bgStatus');
  const bgStatusText = document.getElementById('bgStatusText');
  const bgStatusHint = document.getElementById('bgStatusHint');

  if (!photoInput || !nobgInput) return;

  photoInput.addEventListener('change', async function () {
    // Re-enable submit for the "no file" case; it will be gated by html required
    nobgInput.value = '';

    const file = photoInput.files?.[0];
    if (!file) return;

    if (!isBgRemovalEnabled()) {
      photoInput.dispatchEvent(new Event('photo-upload-ready'));
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (bgStatus) bgStatus.classList.remove('hidden');

    if (bgStatusText && bgStatus?.dataset.textDefault) {
      bgStatusText.textContent = bgStatus.dataset.textDefault;
    }
    if (bgStatusHint && bgStatus?.dataset.textHintTypical) {
      bgStatusHint.textContent = bgStatus.dataset.textHintTypical;
    }

    const stillWorkingTimer = setTimeout(() => {
      if (bgStatusHint && bgStatus?.dataset.textHintSlow) {
        bgStatusHint.textContent = bgStatus.dataset.textHintSlow;
      }
    }, 5000);

    // Fallback timeline when progress events are sparse.
    const fallbackStages = [
      { delayMs: 700, textKey: 'textDownloading' },
      { delayMs: 1800, textKey: 'textDecoding' },
      { delayMs: 3200, textKey: 'textInference' },
      { delayMs: 5600, textKey: 'textMask' },
      { delayMs: 7600, textKey: 'textEncoding' },
    ];
    let latestProgressEventAt = Date.now();
    const fallbackTimers = fallbackStages.map(({ delayMs, textKey }) =>
      setTimeout(() => {
        if (Date.now() - latestProgressEventAt < 1500) return;
        const stageText = bgStatus?.dataset[textKey];
        if (stageText && bgStatusText) bgStatusText.textContent = stageText;
      }, delayMs),
    );

    activeProgressHandler = (key) => {
      latestProgressEventAt = Date.now();
      updateStatusText(bgStatus, bgStatusText, key);
    };

    try {
      console.log(config);
      const blob = await prepareBackgroundRemovedImage(file);

      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'nobg.webp', { type: 'image/webp' }));
      nobgInput.files = dt.files;
      photoInput.dispatchEvent(new Event('photo-upload-ready'));
    } catch (err) {
      // Processing failed — clear any partial result and let server fallback run
      console.warn(
        '[bg-removal] Processing failed, using server fallback:',
        err,
      );
      nobgInput.value = '';
      photoInput.dispatchEvent(new Event('photo-upload-ready'));
    } finally {
      clearTimeout(stillWorkingTimer);
      fallbackTimers.forEach(clearTimeout);
      activeProgressHandler = null;
      if (bgStatus) bgStatus.classList.add('hidden');
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  console.log('wired up photo input for background removal');
};

/** Provides immediate, accessible feedback around the photo upload request. */
export const wireUpPhotoUploadFeedback = () => {
  const form = document.getElementById('photoUploadForm');
  const input = document.getElementById('photoInput');
  const preview = document.getElementById('photoPreview');
  const previewImage = document.getElementById('photoPreviewImage');
  const status = document.getElementById('photoUploadStatus');
  const statusText = document.getElementById('photoUploadStatusText');
  const statusDot = document.getElementById('photoUploadStatusDot');
  const retry = document.getElementById('photoUploadRetry');
  if (!form || !input || !preview || !previewImage || !status || !statusText)
    return;

  let previewUrl;
  const setStatus = (kind, message, canRetry = false) => {
    status.classList.remove('hidden', 'text-info', 'text-success', 'text-error');
    status.classList.add(
      kind === 'error'
        ? 'text-error'
        : kind === 'success'
          ? 'text-success'
          : 'text-info',
    );
    statusDot?.classList.remove('status-info', 'status-success', 'status-error');
    statusDot?.classList.add(
      kind === 'error'
        ? 'status-error'
        : kind === 'success'
          ? 'status-success'
          : 'status-info',
    );
    statusText.textContent = message;
    retry?.classList.toggle('hidden', !canRetry);
  };

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
    preview.classList.remove('hidden');
    setStatus(
      'info',
      document.getElementById('bgRemovalToggle')?.checked
        ? document.getElementById('bgStatusText')?.textContent ||
            'Preparing photo…'
        : status.dataset.readyText,
    );
  });

  input.addEventListener('photo-upload-ready', () =>
    setStatus('info', status.dataset.readyText),
  );
  form.addEventListener('htmx:beforeRequest', () =>
    setStatus('info', status.dataset.savingText),
  );
  form.addEventListener('htmx:responseError', () =>
    setStatus('error', status.dataset.failedText, true),
  );
  form.addEventListener('htmx:sendError', () =>
    setStatus('error', status.dataset.failedText, true),
  );
  retry?.addEventListener('click', () => form.requestSubmit());

  form.addEventListener('htmx:afterRequest', (event) => {
    if (!event.detail.successful) return;
    sessionStorage.setItem('photoUploadMessage', status.dataset.savedText);
  });
};

/**
 * Wires up the edit-mask button on the garment image.
 * Fetches the existing original + nobg images, opens the mask editor,
 * then POSTs only the updated nobg variant to /wardrobe/:id/nobg.
 * @param {string} fileName - The stored filename of the garment photo.
 * @param {number} garmentId - The garment's database ID.
 */
export const wireUpEditMaskBtn = async (fileName, garmentId) => {
  const btn = document.getElementById('editMaskBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const [origResp, nobgResp] = await Promise.all([
        fetch(`/file/${fileName}`),
        fetch(`/file/nobg/${fileName}`),
      ]);
      const origBlob = await origResp.blob();
      const nobgBlob = await nobgResp.blob();

      // Square-pad the original to match the layout used during initial upload,
      // so the restore brush samples from the correct pixel positions.
      const squaredBlob = await squarePadBlob(origBlob);
      const squaredFile = new File([squaredBlob], fileName, {
        type: 'image/png',
      });

      const editedBlob = await openMaskEditor(squaredFile, nobgBlob);

      // openMaskEditor resolves with the exact nobgBlob reference on Skip.
      if (editedBlob === nobgBlob) return;

      const formData = new FormData();
      formData.append(
        'nobgPhoto',
        new File([editedBlob], 'nobg.webp', { type: 'image/webp' }),
      );
      await fetch(`/wardrobe/${garmentId}/nobg`, {
        method: 'POST',
        body: formData,
      });

      // Display the edited result directly from the in-memory blob — avoids
      // any browser cache serving the old nobg image after the POST.
      const img = btn.closest('figure')?.querySelector('img');
      if (img) {
        const objectUrl = URL.createObjectURL(editedBlob);
        img.src = objectUrl;
      }
    } catch (err) {
      console.warn('[edit-mask] Failed:', err);
    } finally {
      btn.disabled = false;
    }
  });
};

export default {
  isBgRemovalEnabled,
  initBackgroundRemoval,
  wireUpPhotoInput,
  wireUpPhotoUploadFeedback,
  prepareBackgroundRemovedImage,
  wireUpEditMaskBtn,
};

// Preload clientside background removal models
(() => initBackgroundRemoval())();
