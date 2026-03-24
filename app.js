const MAX_PREVIEW_SIZE = 920;

const state = {
  fileName: "",
  originalWidth: 0,
  originalHeight: 0,
  sourceCanvas: document.createElement("canvas"),
  selectedColor: null,
  cropRect: null,
};

const ui = {
  imageInput: document.getElementById("imageInput"),
  dropzone: document.getElementById("dropzone"),
  fileMeta: document.getElementById("fileMeta"),
  colorSwatch: document.getElementById("colorSwatch"),
  colorValue: document.getElementById("colorValue"),
  colorDetail: document.getElementById("colorDetail"),
  toleranceRange: document.getElementById("toleranceRange"),
  toleranceValue: document.getElementById("toleranceValue"),
  toggleTop: document.getElementById("toggleTop"),
  toggleBottom: document.getElementById("toggleBottom"),
  toggleLeft: document.getElementById("toggleLeft"),
  toggleRight: document.getElementById("toggleRight"),
  cropButton: document.getElementById("cropButton"),
  downloadButton: document.getElementById("downloadButton"),
  statusCard: document.getElementById("statusCard"),
  sourceCanvas: document.getElementById("sourceCanvas"),
  sourcePlaceholder: document.getElementById("sourcePlaceholder"),
  resultCanvas: document.getElementById("resultCanvas"),
  resultPlaceholder: document.getElementById("resultPlaceholder"),
  resultMeta: document.getElementById("resultMeta"),
};

const sourceCtx = state.sourceCanvas.getContext("2d", { willReadFrequently: true });
const visibleSourceCtx = ui.sourceCanvas.getContext("2d");
const resultCtx = ui.resultCanvas.getContext("2d");

ui.imageInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    loadFile(file);
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  ui.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    ui.dropzone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  ui.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    ui.dropzone.classList.remove("is-dragging");
  });
});

ui.dropzone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) {
    loadFile(file);
  }
});

ui.sourceCanvas.addEventListener("click", (event) => {
  if (!state.originalWidth || !state.originalHeight) {
    return;
  }

  const rect = ui.sourceCanvas.getBoundingClientRect();
  const scaleX = state.originalWidth / rect.width;
  const scaleY = state.originalHeight / rect.height;
  const x = clamp(Math.floor((event.clientX - rect.left) * scaleX), 0, state.originalWidth - 1);
  const y = clamp(Math.floor((event.clientY - rect.top) * scaleY), 0, state.originalHeight - 1);
  const pixel = sourceCtx.getImageData(x, y, 1, 1).data;

  state.selectedColor = {
    r: pixel[0],
    g: pixel[1],
    b: pixel[2],
    a: pixel[3],
  };

  resetCropResult();
  updateColorDisplay(x, y);
  updateCropAvailability();
});

ui.cropButton.addEventListener("click", () => {
  performCrop();
});

ui.downloadButton.addEventListener("click", () => {
  if (!state.cropRect) {
    return;
  }

  const link = document.createElement("a");
  link.download = createDownloadName(state.fileName);
  link.href = ui.resultCanvas.toDataURL("image/png");
  link.click();
});

[ui.toggleTop, ui.toggleBottom, ui.toggleLeft, ui.toggleRight].forEach((toggle) => {
  toggle.addEventListener("change", () => {
    markCropDirty();
    updateCropAvailability();
  });
});

ui.toleranceRange.addEventListener("input", () => {
  ui.toleranceValue.textContent = ui.toleranceRange.value;
  if (state.selectedColor) {
    markCropDirty();
    updateCropAvailability();
  }
});

function setStatus(message, tone = "default") {
  ui.statusCard.textContent = message;
  ui.statusCard.classList.remove("is-success", "is-warning");
  if (tone === "success") {
    ui.statusCard.classList.add("is-success");
  }
  if (tone === "warning") {
    ui.statusCard.classList.add("is-warning");
  }
}

function updateColorDisplay(x, y) {
  const { r, g, b, a } = state.selectedColor;
  const hex = rgbaToHex(r, g, b, a);
  ui.colorSwatch.style.background = `rgba(${r}, ${g}, ${b}, ${a / 255})`;
  ui.colorValue.textContent = hex;
  ui.colorDetail.textContent = `x:${x} y:${y} / rgba(${r}, ${g}, ${b}, ${a})`;
  setStatus(
    `色を選択しました。必要な辺をオンにして「切り抜きを実行」を押すと、各辺から最初に見つかった対象色の1px内側で切り抜きます。`,
    "success",
  );
}

async function loadFile(file) {
  try {
    resetCropResult();
    state.fileName = file.name;
    state.selectedColor = null;
    ui.colorSwatch.style.background = "";
    ui.colorValue.textContent = "未選択";
    ui.colorDetail.textContent = "画像上をクリックしてください";
    ui.fileMeta.textContent = `${file.name} / ${file.type || "unknown"} / ${formatBytes(file.size)}`;

    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (extension === "tif" || extension === "tiff" || file.type === "image/tiff") {
      await drawTiff(file);
    } else {
      await drawRaster(file);
    }

    renderSourcePreview();
    updateCropAvailability();
    setStatus("画像を読み込みました。元画像をクリックして対象色を選んでください。");
  } catch (error) {
    console.error(error);
    setStatus("画像の読み込みに失敗しました。別の画像で試してください。", "warning");
  }
}

async function drawRaster(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      state.originalWidth = bitmap.width;
      state.originalHeight = bitmap.height;
      state.sourceCanvas.width = bitmap.width;
      state.sourceCanvas.height = bitmap.height;
      sourceCtx.clearRect(0, 0, bitmap.width, bitmap.height);
      sourceCtx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return;
    } catch (error) {
      console.warn("createImageBitmap failed, falling back to Image()", error);
    }
  }

  const image = await fileToImage(file);
  state.originalWidth = image.naturalWidth;
  state.originalHeight = image.naturalHeight;
  state.sourceCanvas.width = image.naturalWidth;
  state.sourceCanvas.height = image.naturalHeight;
  sourceCtx.clearRect(0, 0, image.naturalWidth, image.naturalHeight);
  sourceCtx.drawImage(image, 0, 0);
}

async function drawTiff(file) {
  if (!window.UTIF) {
    throw new Error("UTIF library is unavailable.");
  }

  const buffer = await file.arrayBuffer();
  const ifds = window.UTIF.decode(buffer);
  if (!ifds.length) {
    throw new Error("No TIFF frame found.");
  }

  window.UTIF.decodeImage(buffer, ifds[0]);
  const rgba = window.UTIF.toRGBA8(ifds[0]);
  const width = ifds[0].width;
  const height = ifds[0].height;
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);

  state.originalWidth = width;
  state.originalHeight = height;
  state.sourceCanvas.width = width;
  state.sourceCanvas.height = height;
  sourceCtx.clearRect(0, 0, width, height);
  sourceCtx.putImageData(imageData, 0, 0);
}

function renderSourcePreview() {
  const { width, height } = fitIntoBox(state.originalWidth, state.originalHeight, MAX_PREVIEW_SIZE);
  ui.sourceCanvas.width = width;
  ui.sourceCanvas.height = height;
  visibleSourceCtx.clearRect(0, 0, width, height);
  visibleSourceCtx.drawImage(state.sourceCanvas, 0, 0, width, height);
  ui.sourceCanvas.classList.add("is-visible");
  ui.sourcePlaceholder.classList.add("is-hidden");
}

function updateCropAvailability() {
  const hasFile = Boolean(state.originalWidth && state.originalHeight);
  const hasColor = Boolean(state.selectedColor);
  const hasSide = getEnabledSides().length > 0;
  ui.cropButton.disabled = !(hasFile && hasColor && hasSide);

  if (!hasFile) {
    return;
  }

  if (!hasSide) {
    setStatus("少なくとも1つの辺をオンにしてください。", "warning");
    return;
  }

  if (hasColor) {
    setStatus("設定を更新しました。切り抜きを実行できます。");
  }
}

function performCrop() {
  const sides = getEnabledSides();
  if (!state.selectedColor || !sides.length) {
    return;
  }

  const tolerance = Number(ui.toleranceRange.value);
  const imageData = sourceCtx.getImageData(0, 0, state.originalWidth, state.originalHeight);
  const cropRect = computeCropRect(imageData, state.selectedColor, tolerance, sides);

  if (!cropRect) {
    setStatus("対象色が選択した辺から見つかりませんでした。許容差を上げるか、別の色を選んでください。", "warning");
    return;
  }

  const { left, top, width, height, matches } = cropRect;
  if (width <= 0 || height <= 0) {
    setStatus("切り抜き範囲が0px以下になりました。別の辺や色の組み合わせを試してください。", "warning");
    return;
  }

  state.cropRect = cropRect;
  ui.resultCanvas.width = width;
  ui.resultCanvas.height = height;
  resultCtx.clearRect(0, 0, width, height);
  resultCtx.drawImage(state.sourceCanvas, left, top, width, height, 0, 0, width, height);
  ui.resultCanvas.classList.add("is-visible");
  ui.resultPlaceholder.classList.add("is-hidden");
  ui.downloadButton.disabled = false;
  ui.resultMeta.textContent = `${width} x ${height}px`;

  const matchSummary = Object.entries(matches)
    .map(([side, value]) => `${side}:${value}`)
    .join(" / ");
  setStatus(`切り抜き完了。範囲 ${left},${top} から ${width}x${height}px です。検出位置 ${matchSummary}`, "success");
}

function computeCropRect(imageData, color, tolerance, sides) {
  const { width, height, data } = imageData;
  const matches = {};

  let top = 0;
  let bottom = height;
  let left = 0;
  let right = width;

  if (sides.includes("top")) {
    const row = findRowFromTop(data, width, height, color, tolerance);
    if (row === -1) {
      return null;
    }
    top = row + 1;
    matches.top = row;
  }

  if (sides.includes("bottom")) {
    const row = findRowFromBottom(data, width, height, color, tolerance);
    if (row === -1) {
      return null;
    }
    bottom = row;
    matches.bottom = row;
  }

  if (sides.includes("left")) {
    const column = findColumnFromLeft(data, width, height, color, tolerance);
    if (column === -1) {
      return null;
    }
    left = column + 1;
    matches.left = column;
  }

  if (sides.includes("right")) {
    const column = findColumnFromRight(data, width, height, color, tolerance);
    if (column === -1) {
      return null;
    }
    right = column;
    matches.right = column;
  }

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    matches,
  };
}

function findRowFromTop(data, width, height, color, tolerance) {
  for (let y = 0; y < height; y += 1) {
    if (rowHasMatch(data, width, y, color, tolerance)) {
      return y;
    }
  }
  return -1;
}

function findRowFromBottom(data, width, height, color, tolerance) {
  for (let y = height - 1; y >= 0; y -= 1) {
    if (rowHasMatch(data, width, y, color, tolerance)) {
      return y;
    }
  }
  return -1;
}

function findColumnFromLeft(data, width, height, color, tolerance) {
  for (let x = 0; x < width; x += 1) {
    if (columnHasMatch(data, width, height, x, color, tolerance)) {
      return x;
    }
  }
  return -1;
}

function findColumnFromRight(data, width, height, color, tolerance) {
  for (let x = width - 1; x >= 0; x -= 1) {
    if (columnHasMatch(data, width, height, x, color, tolerance)) {
      return x;
    }
  }
  return -1;
}

function rowHasMatch(data, width, y, color, tolerance) {
  for (let x = 0; x < width; x += 1) {
    const index = (y * width + x) * 4;
    if (pixelMatches(data, index, color, tolerance)) {
      return true;
    }
  }
  return false;
}

function columnHasMatch(data, width, height, x, color, tolerance) {
  for (let y = 0; y < height; y += 1) {
    const index = (y * width + x) * 4;
    if (pixelMatches(data, index, color, tolerance)) {
      return true;
    }
  }
  return false;
}

function pixelMatches(data, index, color, tolerance) {
  return (
    Math.abs(data[index] - color.r) <= tolerance &&
    Math.abs(data[index + 1] - color.g) <= tolerance &&
    Math.abs(data[index + 2] - color.b) <= tolerance &&
    Math.abs(data[index + 3] - color.a) <= tolerance
  );
}

function getEnabledSides() {
  const sides = [];
  if (ui.toggleTop.checked) {
    sides.push("top");
  }
  if (ui.toggleBottom.checked) {
    sides.push("bottom");
  }
  if (ui.toggleLeft.checked) {
    sides.push("left");
  }
  if (ui.toggleRight.checked) {
    sides.push("right");
  }
  return sides;
}

function resetCropResult() {
  state.cropRect = null;
  ui.resultCanvas.width = 0;
  ui.resultCanvas.height = 0;
  ui.resultCanvas.classList.remove("is-visible");
  ui.resultPlaceholder.classList.remove("is-hidden");
  ui.resultMeta.textContent = "まだ切り抜き結果はありません";
  ui.downloadButton.disabled = true;
}

function markCropDirty() {
  if (state.cropRect) {
    resetCropResult();
    setStatus("設定が変わったため、切り抜き結果を更新してください。");
  }
}

function fitIntoBox(width, height, maxSize) {
  const ratio = Math.min(maxSize / width, maxSize / height, 1);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rgbaToHex(r, g, b, a) {
  return `#${[r, g, b, a]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createDownloadName(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "") || "snapcrop";
  return `${base}-cropped.png`;
}

function fileToImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to decode image."));
    };
    image.src = url;
  });
}
