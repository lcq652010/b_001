import React, { useState, useRef, useCallback, useEffect } from 'react';
import { initFilter, isWasmReady, destroyFilter, applyPixelFilter } from './wasm/pixelFilter';
import './App.css';

const API_BASE = '/api';
const PRELOAD_COUNT = 10;

function App() {
    const [videoId, setVideoId] = useState(null);
    const [videoInfo, setVideoInfo] = useState(null);
    const [extracting, setExtracting] = useState(false);
    const [extractProgress, setExtractProgress] = useState('');
    const [currentFrame, setCurrentFrame] = useState(0);
    const [totalFrames, setTotalFrames] = useState(0);
    const [loading, setLoading] = useState(false);
    const [wasmReady, setWasmReady] = useState(false);
    const [blockSize, setBlockSize] = useState(16);
    const [playbackActive, setPlaybackActive] = useState(false);
    const [frameReady, setFrameReady] = useState(false);

    const canvasRef = useRef(null);
    const frameCacheRef = useRef(new Map());
    const pendingLoadRef = useRef(new Set());
    const sliderRef = useRef(null);
    const fileInputRef = useRef(null);
    const playbackRef = useRef(null);
    const rafScheduledRef = useRef(false);
    const pendingFrameRef = useRef(null);
    const lastFrameRef = useRef(0);
    const preloadTokenRef = useRef(0);

    useEffect(() => {
        initFilter()
            .then((ok) => {
                setWasmReady(ok);
            })
            .catch((err) => {
                console.error('Failed to init WASM filter:', err);
                alert('WASM 滤镜模块加载失败: ' + err.message);
            });
        return () => {
            destroyFilter();
        };
    }, []);

    useEffect(() => {
        return () => {
            if (playbackRef.current) {
                cancelAnimationFrame(playbackRef.current);
            }
            frameCacheRef.current.clear();
            pendingLoadRef.current.clear();
        };
    }, []);

    const renderToCanvas = useCallback((imgData) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = imgData.width;
        canvas.height = imgData.height;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;
        ctx.putImageData(imgData, 0, 0);
    }, []);

    const processAndRender = useCallback((imgData) => {
        if (!wasmReady || !isWasmReady()) {
            return;
        }
        try {
            const cloned = new ImageData(
                new Uint8ClampedArray(imgData.data),
                imgData.width,
                imgData.height
            );
            applyPixelFilter(cloned, blockSize);
            renderToCanvas(cloned);
        } catch (err) {
            console.error('WASM filter error:', err);
        }
    }, [wasmReady, blockSize, renderToCanvas]);

    const loadFrameImage = useCallback(async (frameIdx) => {
        if (!videoId) return null;
        if (frameIdx < 1 || frameIdx > totalFrames) return null;
        if (frameCacheRef.current.has(frameIdx)) {
            return frameCacheRef.current.get(frameIdx);
        }
        if (pendingLoadRef.current.has(frameIdx)) return null;

        pendingLoadRef.current.add(frameIdx);
        try {
            const resp = await fetch(`${API_BASE}/frames/${videoId}/${frameIdx}`);
            if (!resp.ok) throw new Error(`Frame ${frameIdx}: HTTP ${resp.status}`);
            const blob = await resp.blob();
            const bmp = await createImageBitmap(blob);
            const oc = new OffscreenCanvas(bmp.width, bmp.height);
            const ctx = oc.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
            const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
            bmp.close();

            frameCacheRef.current.set(frameIdx, imgData);

            const maxCache = PRELOAD_COUNT * 2 + 30;
            if (frameCacheRef.current.size > maxCache) {
                const keys = [...frameCacheRef.current.keys()].sort((a, b) => a - b);
                const center = currentFrame;
                keys
                    .sort((a, b) => Math.abs(a - center) - Math.abs(b - center))
                    .slice(maxCache * 0.7)
                    .forEach((k) => frameCacheRef.current.delete(k));
            }

            return imgData;
        } catch (err) {
            console.warn(`Failed to load frame ${frameIdx}:`, err.message);
            return null;
        } finally {
            pendingLoadRef.current.delete(frameIdx);
        }
    }, [videoId, totalFrames, currentFrame]);

    const preloadFrames = useCallback((centerFrame) => {
        if (!videoId || totalFrames === 0) return;
        preloadTokenRef.current += 1;
        const token = preloadTokenRef.current;

        const indices = [];
        for (let i = 1; i <= PRELOAD_COUNT; i++) {
            const next = centerFrame + i;
            const prev = centerFrame - i;
            if (next <= totalFrames) indices.push(next);
            if (prev >= 1) indices.push(prev);
        }

        const toLoad = indices.filter(
            (idx) =>
                !frameCacheRef.current.has(idx) && !pendingLoadRef.current.has(idx)
        );

        if (toLoad.length === 0) return;

        (async () => {
            for (const idx of toLoad) {
                if (token !== preloadTokenRef.current) break;
                if (!frameCacheRef.current.has(idx) && !pendingLoadRef.current.has(idx)) {
                    await loadFrameImage(idx);
                }
            }
        })();
    }, [videoId, totalFrames, loadFrameImage]);

    const requestFrameRender = useCallback((frameIdx) => {
        if (frameIdx < 1 || frameIdx > totalFrames) return;

        const cached = frameCacheRef.current.get(frameIdx);
        if (cached) {
            setFrameReady(true);
            processAndRender(cached);
            preloadFrames(frameIdx);
            return;
        }

        setFrameReady(false);
        pendingFrameRef.current = frameIdx;
        setLoading(true);

        if (!rafScheduledRef.current) {
            rafScheduledRef.current = true;
            requestAnimationFrame(async () => {
                rafScheduledRef.current = false;
                const idx = pendingFrameRef.current;
                if (!idx) return;

                const imgData = await loadFrameImage(idx);
                if (imgData) {
                    if (pendingFrameRef.current === idx || currentFrame === idx) {
                        processAndRender(imgData);
                        setFrameReady(true);
                        setLoading(false);
                        preloadFrames(idx);
                    }
                } else {
                    setLoading(false);
                }
            });
        }
    }, [totalFrames, currentFrame, loadFrameImage, processAndRender, preloadFrames]);

    useEffect(() => {
        if (videoId && totalFrames > 0 && currentFrame > 0) {
            lastFrameRef.current = currentFrame;
            requestFrameRender(currentFrame);
        }
    }, [currentFrame, videoId, totalFrames, requestFrameRender]);

    useEffect(() => {
        if (videoId && totalFrames > 0 && currentFrame > 0) {
            const cached = frameCacheRef.current.get(currentFrame);
            if (cached) {
                processAndRender(cached);
            }
        }
    }, [blockSize, videoId, totalFrames, currentFrame, processAndRender]);

    const pollStatus = useCallback((vid) => {
        let cancelled = false;
        const poll = async () => {
            if (cancelled) return;
            try {
                const resp = await fetch(`${API_BASE}/videos/${vid}/status`);
                const data = await resp.json();
                setTotalFrames(data.totalFrames);
                if (data.totalFrames > 0) {
                    setExtractProgress(`正在提取帧... ${data.totalFrames}`);
                } else {
                    setExtractProgress('正在分析视频...');
                }
                if (data.ready) {
                    setVideoInfo((prev) => ({
                        ...prev,
                        fps: data.fps,
                        width: data.width,
                        height: data.height,
                        duration: data.duration,
                    }));
                    setExtractProgress('');
                    setExtracting(false);
                    if (currentFrame === 0) {
                        setCurrentFrame(1);
                    }
                    return;
                }
                setTimeout(poll, 1000);
            } catch {
                setTimeout(poll, 2000);
            }
        };
        poll();
        return () => { cancelled = true; };
    }, [currentFrame]);

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        frameCacheRef.current.clear();
        pendingLoadRef.current.clear();
        pendingFrameRef.current = null;
        setVideoId(null);
        setVideoInfo(null);
        setCurrentFrame(0);
        setTotalFrames(0);
        setExtracting(true);
        setPlaybackActive(false);
        setFrameReady(false);
        preloadTokenRef.current += 1;

        if (playbackRef.current) {
            cancelAnimationFrame(playbackRef.current);
            playbackRef.current = null;
        }

        const formData = new FormData();
        formData.append('video', file);

        try {
            const resp = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Upload failed');

            if (!data.ffmpegAvailable) {
                alert('服务器端 ffmpeg 不可用，无法在后端抽帧。请确保 ffmpeg 已安装。');
                setExtracting(false);
                return;
            }

            setVideoId(data.videoId);
            setVideoInfo({
                fps: data.fps || 0,
                width: data.width || 0,
                height: data.height || 0,
                duration: data.duration || 0,
            });
            pollStatus(data.videoId);
        } catch (err) {
            alert('上传失败: ' + err.message);
            setExtracting(false);
        }
    };

    const handleSliderInput = (e) => {
        const val = parseInt(e.target.value, 10);
        if (val >= 1 && val <= totalFrames) {
            setCurrentFrame(val);
        }
    };

    const handlePlay = () => {
        if (playbackActive) {
            setPlaybackActive(false);
            if (playbackRef.current) {
                cancelAnimationFrame(playbackRef.current);
                playbackRef.current = null;
            }
            return;
        }
        setPlaybackActive(true);
        const fps = videoInfo?.fps || 30;
        const frameInterval = 1000 / fps;
        let lastTime = performance.now();

        const step = (now) => {
            if (!playbackActive) return;
            const elapsed = now - lastTime;
            if (elapsed >= frameInterval) {
                lastTime = now;
                setCurrentFrame((prev) => {
                    if (prev >= totalFrames) {
                        setPlaybackActive(false);
                        playbackRef.current = null;
                        return 1;
                    }
                    return prev + 1;
                });
            }
            playbackRef.current = requestAnimationFrame(step);
        };
        playbackRef.current = requestAnimationFrame(step);
    };

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    };

    return (
        <div className="app">
            <header className="app-header">
                <h1>Pixel Frame</h1>
                <p className="subtitle">上传视频 · Rust-WASM 像素风滤镜 · 实时预览</p>
            </header>

            <div className="main-content">
                <div className="canvas-area">
                    <canvas ref={canvasRef} className="frame-canvas" />
                    {!videoId && !extracting && (
                        <div className="canvas-placeholder">
                            <div className="placeholder-icon">🎬</div>
                            <p>上传一段视频开始体验</p>
                            <p className="status-sub">
                                WASM 引擎:{' '}
                                <span className={wasmReady ? 'status-ok' : 'status-err'}>
                                    {wasmReady ? '就绪' : '加载中...'}
                                </span>
                            </p>
                        </div>
                    )}
                    {extracting && (
                        <div className="canvas-placeholder">
                            <div className="spinner" />
                            <p>{extractProgress || '正在处理视频...'}</p>
                        </div>
                    )}
                    {loading && !frameReady && (
                        <div className="loading-indicator">加载中...</div>
                    )}
                </div>

                <div className="controls-panel">
                    <div className="upload-section">
                        <label className="upload-btn" htmlFor="video-upload">
                            选择视频文件
                        </label>
                        <input
                            id="video-upload"
                            ref={fileInputRef}
                            type="file"
                            accept="video/*"
                            onChange={handleUpload}
                            className="file-input"
                        />
                        <span className="upload-hint">支持 MP4 / AVI / MOV / MKV / WebM</span>
                    </div>

                    {videoInfo && (
                        <div className="video-info">
                            <div className="info-row">
                                <span className="info-label">分辨率</span>
                                <span className="info-value">
                                    {videoInfo.width}×{videoInfo.height}
                                </span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">帧率</span>
                                <span className="info-value">{videoInfo.fps} FPS</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">时长</span>
                                <span className="info-value">
                                    {videoInfo.duration?.toFixed(2)}s
                                </span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">总帧数</span>
                                <span className="info-value">{totalFrames}</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">滤镜引擎</span>
                                <span className={`info-value ${wasmReady ? 'status-ok' : 'status-err'}`}>
                                    {wasmReady ? 'Rust WASM' : '未加载'}
                                </span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">缓存帧数</span>
                                <span className="info-value">{frameCacheRef.current?.size || 0}</span>
                            </div>
                        </div>
                    )}

                    <div className="block-size-section">
                        <div className="section-label">
                            像素块大小: <strong>{blockSize}×{blockSize}</strong>
                        </div>
                        <input
                            type="range"
                            min={2}
                            max={64}
                            step={2}
                            value={blockSize}
                            onChange={(e) => setBlockSize(parseInt(e.target.value, 10))}
                            className="block-size-slider"
                            disabled={!videoId}
                        />
                        <div className="block-presets">
                            {[4, 8, 16, 32, 48].map((size) => (
                                <button
                                    key={size}
                                    className={`preset-btn ${blockSize === size ? 'active' : ''}`}
                                    onClick={() => setBlockSize(size)}
                                >
                                    {size}
                                </button>
                            ))}
                        </div>
                    </div>

                    {totalFrames > 0 && (
                        <div className="timeline-section">
                            <div className="timeline-header">
                                <span>
                                    帧 {currentFrame} / {totalFrames}
                                </span>
                                <span className="time-display">
                                    {formatTime(currentFrame / (videoInfo?.fps || 30))}
                                </span>
                            </div>
                            <input
                                ref={sliderRef}
                                type="range"
                                min={1}
                                max={totalFrames}
                                value={currentFrame}
                                onChange={handleSliderInput}
                                className="timeline-slider"
                            />
                            <div className="timeline-thumbnails">
                                {Array.from({ length: Math.min(7, totalFrames) }, (_, i) => {
                                    const thumbFrame =
                                        Math.floor((i / 6) * totalFrames) + 1;
                                    return (
                                        <img
                                            key={i}
                                            src={`${API_BASE}/frames/${videoId}/${thumbFrame}`}
                                            className="thumbnail"
                                            alt={`Frame ${thumbFrame}`}
                                            loading="lazy"
                                            draggable={false}
                                            onError={(e) => {
                                                e.target.style.visibility = 'hidden';
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {videoId && !extracting && totalFrames > 0 && (
                        <div className="frame-nav">
                            <button
                                className="nav-btn"
                                disabled={currentFrame <= 1}
                                onClick={() =>
                                    setCurrentFrame((f) => Math.max(1, f - 1))
                                }
                            >
                                ◀ 上一帧
                            </button>
                            <button
                                className={`nav-btn play-btn ${playbackActive ? 'active' : ''}`}
                                onClick={handlePlay}
                            >
                                {playbackActive ? '⏸ 暂停' : '▶ 播放'}
                            </button>
                            <button
                                className="nav-btn"
                                disabled={currentFrame >= totalFrames}
                                onClick={() =>
                                    setCurrentFrame((f) => Math.min(totalFrames, f + 1))
                                }
                            >
                                下一帧 ▶
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <footer className="app-footer">
                Rust → WebAssembly 像素风滤镜 · {blockSize}×{blockSize} 像素块 · 预加载 ±{PRELOAD_COUNT} 帧
            </footer>
        </div>
    );
}

export default App;
