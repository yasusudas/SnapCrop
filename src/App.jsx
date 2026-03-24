import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload, Pipette, Crop, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { motion } from "framer-motion";
import JSZip from "jszip";

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function rgbaToHex(r, g, b) {
    const toHex = (v) => v.toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function colorEquals(data, index, target, tolerance) {
    return (
        Math.abs(data[index] - target.r) <= tolerance &&
        Math.abs(data[index + 1] - target.g) <= tolerance &&
        Math.abs(data[index + 2] - target.b) <= tolerance &&
        Math.abs(data[index + 3] - target.a) <= tolerance
    );
}

function clearCanvas(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
}

async function fileToImageData(file) {
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = () => reject(new Error("ファイルの読み取りに失敗しました。"));
        reader.readAsDataURL(file);
    });

    const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("画像のデコードに失敗しました。"));
        img.src = dataUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvasの初期化に失敗しました。");
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function drawImageDataToCanvas(canvas, imageData) {
    if (!canvas) return;
    if (!imageData) {
        clearCanvas(canvas);
        return;
    }
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.putImageData(imageData, 0, 0);
}

const MAG_SIZE = 160;
const MAG_ZOOM = 8;
const MAG_HALF = MAG_SIZE / 2;
const MAG_SRC = MAG_SIZE / MAG_ZOOM;

function drawMagnifier(magCanvas, srcCanvas, imgX, imgY) {
    if (!magCanvas || !srcCanvas) return;
    magCanvas.width = MAG_SIZE;
    magCanvas.height = MAG_SIZE;

    const ctx = magCanvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, MAG_SIZE, MAG_SIZE);

    ctx.save();
    ctx.beginPath();
    ctx.arc(MAG_HALF, MAG_HALF, MAG_HALF, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, MAG_SIZE, MAG_SIZE);

    const sx = imgX - MAG_SRC / 2;
    const sy = imgY - MAG_SRC / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(srcCanvas, sx, sy, MAG_SRC, MAG_SRC, 0, 0, MAG_SIZE, MAG_SIZE);

    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= MAG_SRC; i++) {
        const p = i * MAG_ZOOM;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, MAG_SIZE);
        ctx.moveTo(0, p);
        ctx.lineTo(MAG_SIZE, p);
        ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(MAG_HALF, 0);
    ctx.lineTo(MAG_HALF, MAG_SIZE);
    ctx.moveTo(0, MAG_HALF);
    ctx.lineTo(MAG_SIZE, MAG_HALF);
    ctx.stroke();

    ctx.strokeStyle = "rgba(30,41,59,0.9)";
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(MAG_HALF, 0);
    ctx.lineTo(MAG_HALF, MAG_SIZE);
    ctx.moveTo(0, MAG_HALF);
    ctx.lineTo(MAG_SIZE, MAG_HALF);
    ctx.stroke();

    ctx.restore();

    ctx.beginPath();
    ctx.arc(MAG_HALF, MAG_HALF, MAG_HALF - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(30,41,59,0.5)";
    ctx.lineWidth = 3;
    ctx.stroke();
}

function getPixelIndex(width, x, y) {
    return (y * width + x) * 4;
}

function matchesToleranceAt(imageData, x, y, target, tolerance) {
    const index = getPixelIndex(imageData.width, x, y);
    return colorEquals(imageData.data, index, target, tolerance);
}

function findBoundaryFromTopAtX(imageData, x, target, tolerance) {
    for (let y = 0; y < imageData.height; y++) {
        if (matchesToleranceAt(imageData, x, y, target, tolerance)) {
            return clamp(y + 1, 0, imageData.height);
        }
    }
    return 0;
}

function findBoundaryFromBottomAtX(imageData, x, target, tolerance) {
    for (let y = imageData.height - 1; y >= 0; y--) {
        if (matchesToleranceAt(imageData, x, y, target, tolerance)) {
            return clamp(y, 0, imageData.height);
        }
    }
    return imageData.height;
}

function findBoundaryFromLeftAtY(imageData, y, target, tolerance) {
    for (let x = 0; x < imageData.width; x++) {
        if (matchesToleranceAt(imageData, x, y, target, tolerance)) {
            return clamp(x + 1, 0, imageData.width);
        }
    }
    return 0;
}

function findBoundaryFromRightAtY(imageData, y, target, tolerance) {
    for (let x = imageData.width - 1; x >= 0; x--) {
        if (matchesToleranceAt(imageData, x, y, target, tolerance)) {
            return clamp(x, 0, imageData.width);
        }
    }
    return imageData.width;
}

function cropImageData(imageData, bounds) {
    const left = clamp(bounds.left, 0, imageData.width);
    const top = clamp(bounds.top, 0, imageData.height);
    const right = clamp(bounds.right, 0, imageData.width);
    const bottom = clamp(bounds.bottom, 0, imageData.height);
    const width = right - left;
    const height = bottom - top;
    const output = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
        const srcStart = ((y + top) * imageData.width + left) * 4;
        output.data.set(imageData.data.slice(srcStart, srcStart + width * 4), y * width * 4);
    }
    return output;
}



function imageDataToBlob(imageData) {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
            reject(new Error("Canvasの初期化に失敗しました。"));
            return;
        }
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("PNGの生成に失敗しました。"));
                return;
            }
            resolve(blob);
        }, "image/png");
    });
}

function imageDataToDataUrl(imageData) {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return "";
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
}

function applyCropToImage(imageData, selectedColor, directions, tolerance) {
    const baseX = clamp(selectedColor.x, 0, imageData.width - 1);
    const baseY = clamp(selectedColor.y, 0, imageData.height - 1);

    let left = 0;
    let top = 0;
    let right = imageData.width;
    let bottom = imageData.height;

    if (directions.top) {
        top = findBoundaryFromTopAtX(imageData, baseX, selectedColor, tolerance);
    }
    if (directions.bottom) {
        bottom = findBoundaryFromBottomAtX(imageData, baseX, selectedColor, tolerance);
    }
    if (directions.left) {
        left = findBoundaryFromLeftAtY(imageData, baseY, selectedColor, tolerance);
    }
    if (directions.right) {
        right = findBoundaryFromRightAtY(imageData, baseY, selectedColor, tolerance);
    }

    if (left >= right || top >= bottom) {
        return {
            ok: false,
            reason: "切り抜き範囲が空です。選択色や方向を見直してください。",
            bounds: { left, top, right, bottom },
        };
    }

    return {
        ok: true,
        croppedData: cropImageData(imageData, { left, top, right, bottom }),
        bounds: { left, top, right, bottom },
    };
}

function makeQueueItem(file, imageData, index) {
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return {
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        file,
        name: file.name,
        outputName: `${baseName}_cropped.png`,
        imageData,
        croppedData: null,
        previewUrl: imageDataToDataUrl(imageData),
        croppedPreviewUrl: "",
        error: "",
    };
}

export default function ColorBasedPixelCropper() {
    const [queue, setQueue] = useState([]);
    const [activeId, setActiveId] = useState("");
    const [selectedColor, setSelectedColor] = useState(null);
    const [status, setStatus] = useState("画像を読み込んでください。");
    const [isLoading, setIsLoading] = useState(false);
    const [isCroppingAll, setIsCroppingAll] = useState(false);
    const [isDownloadingZip, setIsDownloadingZip] = useState(false);
    const [isPicking, setIsPicking] = useState(false);
    const [mousePos, setMousePos] = useState(null);
    const [zipUrl, setZipUrl] = useState("");
    const [zipName, setZipName] = useState("");
    const [activePngUrl, setActivePngUrl] = useState("");
    const [activePngName, setActivePngName] = useState("");
    const [hoverColor, setHoverColor] = useState(null);
    const [directions, setDirections] = useState({
        top: false,
        bottom: true,
        left: false,
        right: false,
    });
    const [tolerance, setTolerance] = useState(0);


    const fileInputRef = useRef(null);
    const originalCanvasRef = useRef(null);
    const croppedCanvasRef = useRef(null);
    const magnifierRef = useRef(null);

    const activeItem = useMemo(() => queue.find((item) => item.id === activeId) || queue[0] || null, [queue, activeId]);
    const imageData = activeItem?.imageData || null;
    const croppedData = activeItem?.croppedData || null;
    const imageInfo = useMemo(() => (imageData ? `${imageData.width} × ${imageData.height}px` : null), [imageData]);
    const croppedInfo = useMemo(() => (croppedData ? `${croppedData.width} × ${croppedData.height}px` : null), [croppedData]);
    const displayColor = hoverColor || selectedColor;

    useEffect(() => {
        if (activeItem && activeItem.id !== activeId) {
            setActiveId(activeItem.id);
        }
    }, [activeItem, activeId]);

    useEffect(() => {
        drawImageDataToCanvas(originalCanvasRef.current, imageData);
    }, [imageData, activeId]);

    useEffect(() => {
        drawImageDataToCanvas(croppedCanvasRef.current, croppedData);
    }, [croppedData, activeId]);

    useEffect(() => {
        if (!isPicking || !mousePos || !magnifierRef.current || !originalCanvasRef.current) return;
        drawMagnifier(magnifierRef.current, originalCanvasRef.current, mousePos.imgX, mousePos.imgY);
    }, [isPicking, mousePos, activeId]);



    async function handleFileChange(event) {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        setIsLoading(true);
        setIsPicking(false);
        setMousePos(null);
        setHoverColor(null);
        setStatus("画像を読み込み中です…");

        try {
            const loadedItems = [];
            for (let i = 0; i < files.length; i += 1) {
                const image = await fileToImageData(files[i]);
                loadedItems.push(makeQueueItem(files[i], image, i));
            }
            setQueue(loadedItems);
            setActiveId(loadedItems[0]?.id || "");
            setSelectedColor(null);
            setStatus(`画像を${loadedItems.length}枚読み込みました。1枚目で基準色を選択すると、その設定をキュー全体に適用します。`);
        } catch (error) {
            setQueue([]);
            setActiveId("");
            setSelectedColor(null);
            setStatus(error instanceof Error ? error.message : "画像の読み込みに失敗しました。");
        } finally {
            if (event.target) event.target.value = "";
            setIsLoading(false);
        }
    }

    function getImagePixelFromEvent(event) {
        const canvas = originalCanvasRef.current;
        if (!canvas || !canvas.width || !canvas.height) return null;
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const imgX = clamp(Math.floor((event.clientX - rect.left) * scaleX), 0, canvas.width - 1);
        const imgY = clamp(Math.floor((event.clientY - rect.top) * scaleY), 0, canvas.height - 1);
        return { imgX, imgY };
    }

    function handleCanvasMouseMove(event) {
        if (!isPicking || !imageData) return;
        const pos = getImagePixelFromEvent(event);
        if (!pos) return;
        const idx = (pos.imgY * imageData.width + pos.imgX) * 4;

        setMousePos({
            imgX: pos.imgX,
            imgY: pos.imgY,
            clientX: event.clientX,
            clientY: event.clientY,
        });
        setHoverColor({
            r: imageData.data[idx],
            g: imageData.data[idx + 1],
            b: imageData.data[idx + 2],
            a: imageData.data[idx + 3],
        });
    }

    function handleCanvasMouseLeave() {
        setMousePos(null);
        setHoverColor(null);
    }

    function handleCanvasClick(event) {
        if (!isPicking || !imageData || !activeItem) return;
        const pos = getImagePixelFromEvent(event);
        if (!pos) return;
        const idx = (pos.imgY * imageData.width + pos.imgX) * 4;
        setSelectedColor({
            r: imageData.data[idx],
            g: imageData.data[idx + 1],
            b: imageData.data[idx + 2],
            a: imageData.data[idx + 3],
            x: pos.imgX,
            y: pos.imgY,
        });
        setIsPicking(false);
        setMousePos(null);
        setHoverColor(null);
        setStatus(`基準色を選択しました。座標: (${pos.imgX}, ${pos.imgY})。この設定でキュー全体を切り抜けます。`);
    }

    function handleCropAll() {
        if (!queue.length) {
            setStatus("先に画像を読み込んでください。");
            return;
        }
        if (!selectedColor) {
            setStatus("先に1枚目の画像で色を選択してください。");
            return;
        }
        if (!Object.values(directions).some(Boolean)) {
            setStatus("少なくとも1方向をオンにしてください。");
            return;
        }

        setIsCroppingAll(true);
        let successCount = 0;
        let failCount = 0;

        const nextQueue = queue.map((item) => {
            const result = applyCropToImage(item.imageData, selectedColor, directions, tolerance);
            if (!result.ok) {
                failCount += 1;
                return {
                    ...item,
                    croppedData: null,
                    croppedPreviewUrl: "",
                    error: result.reason,
                };
            }
            successCount += 1;
            return {
                ...item,
                croppedData: result.croppedData,
                croppedPreviewUrl: imageDataToDataUrl(result.croppedData),
                error: "",
            };
        });

        setQueue(nextQueue);
        setIsCroppingAll(false);
        setStatus(`一括切り抜き完了: 成功 ${successCount} 枚 / 失敗 ${failCount} 枚`);
    }

    function resetAll() {
        if (zipUrl) URL.revokeObjectURL(zipUrl);
        if (activePngUrl) URL.revokeObjectURL(activePngUrl);
        setQueue((prev) => {
            for (const item of prev) {
                if (item.downloadUrl) URL.revokeObjectURL(item.downloadUrl);
            }
            return [];
        });
        setActiveId("");
        setSelectedColor(null);
        setIsLoading(false);
        setIsCroppingAll(false);
        setIsDownloadingZip(false);
        setIsPicking(false);
        setMousePos(null);
        setHoverColor(null);
        setDirections({ top: false, bottom: true, left: false, right: false });
        setTolerance(0);
        setZipUrl("");
        setZipName("");
        setActivePngUrl("");
        setActivePngName("");
        setStatus("画像を読み込んでください。");
        if (fileInputRef.current) fileInputRef.current.value = "";
    }

    async function handlePrepareActivePng() {
        if (!activeItem?.croppedData) {
            setStatus("先に切り抜きを実行してください。");
            return;
        }
        try {
            if (activePngUrl) URL.revokeObjectURL(activePngUrl);
            const blob = await imageDataToBlob(activeItem.croppedData);
            const url = URL.createObjectURL(blob);
            setActivePngUrl(url);
            setActivePngName(activeItem.outputName);
            setStatus(`PNGダウンロードリンクを生成しました。クリックで保存してください。`);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "PNGの出力に失敗しました。");
        }
    }

    async function handlePrepareZip() {
        const processedItems = queue.filter((item) => item.croppedData);
        if (!processedItems.length) {
            setStatus("ZIPに入れる切り抜き済み画像がありません。");
            return;
        }

        setIsDownloadingZip(true);
        try {
            if (zipUrl) URL.revokeObjectURL(zipUrl);
            const zip = new JSZip();
            for (const item of processedItems) {
                const blob = await imageDataToBlob(item.croppedData);
                zip.file(item.outputName, blob);
            }
            const blob = await zip.generateAsync({ type: "blob" });
            const name = `cropped_images_${new Date().toISOString().slice(0, 10)}.zip`;
            const url = URL.createObjectURL(blob);
            setZipUrl(url);
            setZipName(name);
            setStatus(`ZIPダウンロードリンクを生成しました (${processedItems.length} 枚)。クリックで保存してください。`);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "ZIPの生成に失敗しました。");
        } finally {
            setIsDownloadingZip(false);
        }
    }

    async function handlePrepareItemPng(item) {
        if (!item.croppedData) return;
        try {
            const blob = await imageDataToBlob(item.croppedData);
            const url = URL.createObjectURL(blob);
            setQueue((prev) =>
                prev.map((q) => {
                    if (q.id === item.id) {
                        if (q.downloadUrl) URL.revokeObjectURL(q.downloadUrl);
                        return { ...q, downloadUrl: url };
                    }
                    return q;
                })
            );
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "PNGの保存に失敗しました。");
        }
    }

    const magStyle = useMemo(() => {
        if (!mousePos) return {};
        return {
            position: "fixed",
            left: mousePos.clientX - MAG_HALF,
            top: mousePos.clientY - MAG_HALF,
            pointerEvents: "none",
            zIndex: 9999,
        };
    }, [mousePos]);

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
            {isPicking && mousePos && (
                <div style={magStyle}>
                    <canvas
                        ref={magnifierRef}
                        width={MAG_SIZE}
                        height={MAG_SIZE}
                        style={{ display: "block", borderRadius: "50%", boxShadow: "0 6px 24px rgba(0,0,0,0.35)" }}
                    />
                    {hoverColor && (
                        <div
                            style={{
                                marginTop: 6,
                                background: "rgba(15,23,42,0.85)",
                                color: "#fff",
                                fontSize: 11,
                                borderRadius: 8,
                                padding: "4px 8px",
                                textAlign: "center",
                                backdropFilter: "blur(4px)",
                                userSelect: "none",
                                whiteSpace: "nowrap",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                                <div
                                    style={{
                                        width: 12,
                                        height: 12,
                                        borderRadius: 3,
                                        flexShrink: 0,
                                        background: `rgb(${hoverColor.r},${hoverColor.g},${hoverColor.b})`,
                                        border: "1px solid rgba(255,255,255,0.3)",
                                    }}
                                />
                                <span>{rgbaToHex(hoverColor.r, hoverColor.g, hoverColor.b)}</span>
                            </div>
                            <div style={{ opacity: 0.7, marginTop: 2 }}>
                                ({mousePos.imgX}, {mousePos.imgY})
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="mx-auto max-w-7xl space-y-6">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="space-y-2"
                >
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 md:text-4xl">SnapCrop</h1>
                </motion.div>

                <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
                    <Card className="rounded-3xl border-slate-200 shadow-sm">
                        <CardHeader>
                            <CardTitle className="text-xl">設定</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-6">
                            <div className="space-y-3">
                                <Label htmlFor="file" className="text-sm font-medium text-slate-700">
                                    画像を読み込む
                                </Label>
                                <label
                                    htmlFor="file"
                                    className="flex cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-600 transition hover:border-slate-500 hover:bg-slate-100"
                                >
                                    <Upload className="h-5 w-5" />
                                    <span>{isLoading ? "読み込み中…" : "jpg / png を選択"}</span>
                                </label>
                                <input
                                    ref={fileInputRef}
                                    id="file"
                                    type="file"
                                    accept=".jpg,.jpeg,.png,image/png,image/jpeg"
                                    multiple
                                    className="hidden"
                                    onChange={handleFileChange}
                                />
                            </div>

                            <div className="grid gap-3 rounded-2xl bg-slate-100 p-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-700">読み込み枚数</span>
                                    <Badge variant="secondary" className="rounded-full">{queue.length} 枚</Badge>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-700">元画像</span>
                                    <Badge variant="secondary" className="rounded-full">{imageInfo || "未読込"}</Badge>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-700">切り抜き後</span>
                                    <Badge variant="secondary" className="rounded-full">{croppedInfo || "未生成"}</Badge>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-sm font-medium text-slate-700">基準色</Label>
                                    {selectedColor ? (
                                        <Badge className="rounded-full bg-slate-900 text-white hover:bg-slate-900">
                                            {rgbaToHex(selectedColor.r, selectedColor.g, selectedColor.b)}
                                        </Badge>
                                    ) : (
                                        <Badge variant="secondary" className="rounded-full">未選択</Badge>
                                    )}
                                </div>
                                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                                    <div
                                        className="h-10 w-10 rounded-xl border border-slate-300"
                                        style={{
                                            backgroundColor: displayColor
                                                ? `rgba(${displayColor.r},${displayColor.g},${displayColor.b},${displayColor.a / 255})`
                                                : "transparent",
                                            backgroundImage: displayColor
                                                ? "none"
                                                : "linear-gradient(45deg,#e2e8f0 25%,transparent 25%,transparent 75%,#e2e8f0 75%,#e2e8f0),linear-gradient(45deg,#e2e8f0 25%,transparent 25%,transparent 75%,#e2e8f0 75%,#e2e8f0)",
                                            backgroundPosition: displayColor ? undefined : "0 0,8px 8px",
                                            backgroundSize: displayColor ? undefined : "16px 16px",
                                        }}
                                    />
                                    <div className="min-w-0 flex-1 text-sm text-slate-600">
                                        {hoverColor ? (
                                            <div className="space-y-1 italic text-slate-400">
                                                <div>R {hoverColor.r} / G {hoverColor.g} / B {hoverColor.b} / A {hoverColor.a}</div>
                                                <div>ホバー中…クリックで基準色を確定</div>
                                            </div>
                                        ) : selectedColor ? (
                                            <div className="space-y-1">
                                                <div>R {selectedColor.r} / G {selectedColor.g} / B {selectedColor.b} / A {selectedColor.a}</div>
                                                <div>座標: ({selectedColor.x}, {selectedColor.y})</div>
                                            </div>
                                        ) : (
                                            <div>スポイトで基準色を選択</div>
                                        )}
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant={isPicking ? "default" : "outline"}
                                    className="w-full rounded-2xl"
                                    onClick={() => {
                                        setIsPicking((p) => !p);
                                        setMousePos(null);
                                        setHoverColor(null);
                                    }}
                                    disabled={!activeItem}
                                >
                                    <Pipette className="mr-2 h-4 w-4" />
                                    {isPicking ? "スポイト待機中（クリックで基準色を確定）" : "スポイトを有効化"}
                                </Button>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="text-sm font-medium text-slate-700">切り抜き方向</div>
                                <div className="grid grid-cols-2 gap-3">
                                    {[
                                        ["top", "上から"],
                                        ["bottom", "下から"],
                                        ["left", "左から"],
                                        ["right", "右から"],
                                    ].map(([key, label]) => {
                                        const isOn = directions[key];
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => {
                                                    setDirections((prev) => ({ ...prev, [key]: !prev[key] }));
                                                }}
                                                className={`rounded-2xl border px-4 py-4 text-sm font-medium transition ${
                                                    isOn
                                                        ? "border-slate-900 bg-slate-900 text-white"
                                                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                                                }`}
                                                aria-pressed={isOn}
                                            >
                                                <div className="flex items-center justify-between gap-3">
                                                    <span>{label}</span>
                                                    <span className={`rounded-full px-2 py-0.5 text-xs ${isOn ? "bg-white/15 text-white" : "bg-white text-slate-500"}`}>
                                                        {isOn ? "ON" : "OFF"}
                                                    </span>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="text-sm font-medium text-slate-700">色の許容量</div>
                                <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-3">
                                    <div className="flex items-center justify-between text-sm text-slate-700">
                                        <Label htmlFor="tol-unified">Tolerance</Label>
                                        <span>{tolerance}</span>
                                    </div>
                                    <input
                                        id="tol-unified"
                                        type="range"
                                        min="0"
                                        max="255"
                                        step="1"
                                        value={tolerance}
                                        onChange={(event) => {
                                            setTolerance(Number(event.target.value));
                                        }}
                                        className="w-full"
                                    />
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <Button type="button" className="rounded-2xl" onClick={handleCropAll} disabled={!queue.length || !selectedColor || isCroppingAll}>
                                    <Crop className="mr-2 h-4 w-4" />
                                    {isCroppingAll ? "処理中…" : "全画像に適用"}
                                </Button>
                                <Button type="button" variant="outline" className="rounded-2xl" onClick={resetAll}>
                                    <RotateCcw className="mr-2 h-4 w-4" />
                                    リセット
                                </Button>
                            </div>

                            <div className="space-y-3">
                                <Alert className="rounded-2xl border-slate-200 bg-slate-50">
                                    <AlertDescription className="text-sm leading-6 text-slate-700">{status}</AlertDescription>
                                </Alert>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full rounded-2xl"
                                    onClick={handlePrepareZip}
                                    disabled={!queue.some((item) => item.croppedData) || isDownloadingZip}
                                >
                                    {isDownloadingZip ? "ZIPを生成中…" : "ZIPを生成"}
                                </Button>
                                {zipUrl && (
                                    <a
                                        href={zipUrl}
                                        download={zipName || "cropped_images.zip"}
                                        className="mt-2 flex w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                                    >
                                        ZIPをダウンロード
                                    </a>
                                )}

                            </div>
                        </CardContent>
                    </Card>

                    <div className="space-y-6">
                        <div className="grid gap-6 xl:grid-cols-2">
                            <Card className="rounded-3xl border-slate-200 shadow-sm">
                                <CardHeader>
                                    <CardTitle className="text-xl">基準画像</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white p-3">
                                        <canvas
                                            ref={originalCanvasRef}
                                            onClick={handleCanvasClick}
                                            onMouseMove={handleCanvasMouseMove}
                                            onMouseLeave={handleCanvasMouseLeave}
                                            className={`max-w-full rounded-xl ${isPicking ? "cursor-none ring-2 ring-blue-400" : "cursor-default"}`}
                                        />
                                    </div>
                                </CardContent>
                            </Card>

                            <Card className="rounded-3xl border-slate-200 shadow-sm">
                                <CardHeader>
                                    <CardTitle className="text-xl">選択中画像の結果</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="overflow-auto rounded-2xl border border-slate-200 bg-white p-3">
                                        <canvas ref={croppedCanvasRef} className="max-w-full rounded-xl" />
                                    </div>
                                    {activeItem?.croppedData && (
                                        <div className="mt-4 space-y-2">
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                className="w-full rounded-2xl"
                                                onClick={handlePrepareActivePng}
                                            >
                                                PNGダウンロードリンクを生成
                                            </Button>
                                            {activePngUrl && (
                                                <a
                                                    href={activePngUrl}
                                                    download={activePngName || "cropped.png"}
                                                    className="flex w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                                                >
                                                    PNGをダウンロード
                                                </a>
                                            )}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        <Card className="rounded-3xl border-slate-200 shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-xl">キュー</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3">
                                    {queue.length === 0 && (
                                        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                                            まだ画像はありません。
                                        </div>
                                    )}
                                    {queue.map((item, index) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            onClick={() => {
                                                setActiveId(item.id);
                                                setIsPicking(false);
                                                setMousePos(null);
                                                setHoverColor(null);
                                            }}
                                            className={`block w-full rounded-2xl border p-3 text-left transition ${item.id === activeId ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"}`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="h-20 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                                                    {item.previewUrl && (
                                                        <img src={item.previewUrl} alt={item.name} className="h-full w-full object-contain" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="truncate text-sm font-medium text-slate-900">
                                                                {index === 0 ? `基準 ${item.name}` : item.name}
                                                            </div>
                                                            <div className="mt-1 text-xs text-slate-500">
                                                                {item.imageData.width} × {item.imageData.height}px
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-2">
                                                            <Badge variant={item.croppedData ? "default" : "secondary"} className="rounded-full">
                                                                {item.croppedData ? "処理済み" : "未処理"}
                                                            </Badge>
                                                            <div className="h-8 rounded-xl border border-slate-200 px-3 text-xs leading-8 text-slate-600">
                                                                {item.id === activeId ? "選択中" : "クリックで表示"}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    {item.error && <div className="mt-2 text-xs text-red-600">{item.error}</div>}
                                                    {item.croppedPreviewUrl && (
                                                        <div className="mt-3 flex items-center gap-3">
                                                            <div className="h-16 w-12 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                                                                <img src={item.croppedPreviewUrl} alt={`${item.name} cropped`} className="h-full w-full object-contain" />
                                                            </div>
                                                            {item.downloadUrl ? (
                                                                <a
                                                                    href={item.downloadUrl}
                                                                    download={item.outputName}
                                                                    className="inline-flex h-8 items-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                                                                    onClick={(event) => event.stopPropagation()}
                                                                >
                                                                    ダウンロード
                                                                </a>
                                                            ) : (
                                                                <Button
                                                                    type="button"
                                                                    variant="secondary"
                                                                    className="h-8 rounded-xl px-3 text-xs"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        handlePrepareItemPng(item);
                                                                    }}
                                                                >
                                                                    保存準備
                                                                </Button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
}
