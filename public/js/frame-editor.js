/** A lightweight square composition editor for garment photos. */
export function openFrameEditor(file) {
  return new Promise(async (resolve) => {
    const dialog = document.getElementById('frameEditorDialog');
    const canvas = document.getElementById('frameEditorCanvas');
    const zoomInput = document.getElementById('frameEditorZoom');
    const paddingInput = document.getElementById('frameEditorPadding');
    const acceptButton = document.getElementById('frameEditorAccept');
    const cancelButton = document.getElementById('frameEditorCancel');
    const backdropButton = document.getElementById('frameEditorBackdrop');
    const context = canvas.getContext('2d');
    const image = await createImageBitmap(file);
    const outputSize = 1024;
    canvas.width = outputSize;
    canvas.height = outputSize;

    let offsetX = 0;
    let offsetY = 0;
    let startX = 0;
    let startY = 0;
    let startOffsetX = 0;
    let startOffsetY = 0;
    let dragging = false;
    let settled = false;

    const baseScale = () => {
      const padding = Number(paddingInput.value) / 100;
      return (outputSize * (1 - padding * 2)) / Math.max(image.width, image.height);
    };
    const scale = () => baseScale() * (Number(zoomInput.value) / 100);
    const draw = () => {
      context.clearRect(0, 0, outputSize, outputSize);
      const size = scale();
      const width = image.width * size;
      const height = image.height * size;
      context.drawImage(image, (outputSize - width) / 2 + offsetX, (outputSize - height) / 2 + offsetY, width, height);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      image.close();
      cleanup();
      resolve(result);
    };
    const onPointerDown = (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startOffsetX = offsetX;
      startOffsetY = offsetY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event) => {
      if (!dragging) return;
      const bounds = canvas.getBoundingClientRect();
      offsetX = startOffsetX + (event.clientX - startX) * (outputSize / bounds.width);
      offsetY = startOffsetY + (event.clientY - startY) * (outputSize / bounds.height);
      draw();
    };
    const onPointerUp = () => { dragging = false; };
    const onAccept = () => canvas.toBlob((blob) => finish(blob ?? file), 'image/webp', 0.95);
    const onCancel = () => finish(file);
    const onDialogCancel = (event) => { event.preventDefault(); onCancel(); };
    const cleanup = () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      zoomInput.removeEventListener('input', draw);
      paddingInput.removeEventListener('input', draw);
      acceptButton.removeEventListener('click', onAccept);
      cancelButton.removeEventListener('click', onCancel);
      backdropButton.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onDialogCancel);
      dialog.close();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    zoomInput.addEventListener('input', draw);
    paddingInput.addEventListener('input', draw);
    acceptButton.addEventListener('click', onAccept);
    cancelButton.addEventListener('click', onCancel);
    backdropButton.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onDialogCancel);
    draw();
    dialog.showModal();
  });
}
