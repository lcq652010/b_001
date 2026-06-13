import React, { useState, useRef, useCallback, useEffect } from 'react';
import { initFilter, isWasmReady, applyPixelFilter } from './wasm/pixelFilter';
import './App.css';

const API_BASE = '/api';

function App() {
    const [videoId, setVideoId] = useState(null);
    const [videoInfo, setVideoInfo] = useState(null);
    const [extracting, setExtracting] = useState(false);
    const [extractProgress, setExtractProgress] = useState('');
    const [currentFrame, setCurrentFrame] = useState(0);
    const [totalFrames, setTotalFrames] = useState(0);
    const [loading, setLoading] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [wasmReady, setWasmReady] = useState(false);
    const [filterMode, setFilterMode] = useState('加载中...');
    const [blockSize, setBlockSize] = useState(16);
    const [useFrontendExtraction, setUseFrontendExtraction] = useState(false);
    const [playbackActive, setPlaybackActive] = useState(false);

    const canvasRef = useRef(null);
    const frameCacheRef = useRef(new Map());
    const pendingRef = useRef(new Set());
    const sliderRef = useRef(null);
    const fileInputRef = useRef(null);
    const hiddenVideoRef = useRef(null);
    const offscreenCanvasRef = useRef(null);
    const videoObjectUrlRef = useRef(null);
    const playbackRef = useRef(null);

    useEffect(() => {
        initFilter().then((wasmOk) => {
            setWasmReady(wasmOk);
            setFilterMode(wasmOk ? 'WASM' : 'JS 降级');
        });
    }, []);

    useEffect(() => {
        return () => {
            if (videoObjectUrlRef.current) {
                URL.revokeObjectURL(videoObjectUrlRef.current);
            }
            if (playbackRef.current) {
                cancelAnimationFrame(playbackRef.current);
            }
        };
    }, []);

    const renderFrame = useCallback((imageData, bs) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const filtered = applyPixelFilter(imageData, bs || blockSize);
        canvas.width = filtered.width;
        canvas.height = filtered.height;
        const ctx = canvas.getContext('2d');
        ctx.putImageData(filtered, 0, 0);
    }, [blockSize]);

    const loadFrameFromBackend = useCallback(
        async (frameIdx) => {
            if (!videoId) return;
            if (frameCacheRef.current.has(frameIdx)) {
                renderFrame(new ImageData(
                    new Uint8ClampedArray(frameCacheRef.current.get(frameIdx).data),
                    frameCacheRef.current.get(frameIdx).width,
                    frameCacheRef.current.get(frameIdx).height
                ));
                return;
            }
            if (pendingRef.current.has(frameIdx)) return;
            pendingRef.current.add(frameIdx);
            setLoading(true);
            try {
                const resp = await fetch(`${API_BASE}/frames/${videoId}/${frameIdx}`);
                if (!resp.ok) throw new Error(`Frame ${frameIdx} not found`);
                const blob = await resp.blob();
                const bmp = await createImageBitmap(blob);
                const offscreen = new OffscreenCanvas(bmp.width, bmp.height);
                const ctx = offscreen.getContext('2d');
                ctx.drawImage(bmp, 0, 0);
                const imgData = ctx.getImageData(0, 0, bmp.width, bmp.height);
                frameCacheRef.current.set(frameIdx, imgData);
                if (frameCacheRef.current.size > 60) {
                    const oldest = frameCacheRef.current.keys().next().value;
                    frameCacheRef.current.delete(oldest);
                }
                if (frameIdx === currentFrame) {
                    renderFrame(new ImageData(
                        new Uint8ClampedArray(imgData.data),
                        imgData.width,
                        imgData.height
                    ));
                }
            } catch (err) {
                console.error('Load frame error:', err);
            } finally {
                pendingRef.current.delete(frameIdx);
                setLoading(false);
            }
        },
        [videoId, currentFrame, renderFrame]
    );

    const extractFrameFromVideo = useCallback(
        (frameIdx, fps) => {
            return new Promise((resolve, reject) => {
                const video = hiddenVideoRef.current;
                if (!video || !video.duration) {
                    reject(new Error('Video not ready'));
                    return;
                }
                const time = (frameIdx - 1) / fps;
                if (time > video.duration) {
                    reject(new Error('Time exceeds duration'));
                    return;
                }
                video.currentTime = time;
                const onSeeked = () => {
                    video.removeEventListener('seeked', onSeeked);
                    video.removeEventListener('error', onError);
                    const oc = offscreenCanvasRef.current || (offscreenCanvasRef.current = new OffscreenCanvas(video.videoWidth, video.videoHeight));
                    oc.width = video.videoWidth;
                    oc.height = video.videoHeight;
                    const ctx = oc.getContext('2d');
                    ctx.drawImage(video, 0, 0);
                    const imgData = ctx.getImageData(0, 0, oc.width, oc.height);
                    resolve(imgData);
                };
                const onError = (e) => {
                    video.removeEventListener('seeked', onSeeked);
                    video.removeEventListener('error', onError);
                    reject(e);
                };
                video.addEventListener('seeked', onSeeked);
                video.addEventListener('error', onError);
                video.currentTime = time;
            });
        },
        []
    );

    const loadFrameFromVideo = useCallback(
        async (frameIdx) => {
            if (!videoInfo || !videoInfo.fps) return;
            if (frameCacheRef.current.has(frameIdx)) {
                renderFrame(new ImageData(
                    new Uint8ClampedArray(frameCacheRef.current.get(frameIdx).data),
                    frameCacheRef.current.get(frameIdx).width,
                    frameCacheRef.current.get(frameIdx).height
                ));
                return;
            }
            if (pendingRef.current.has(frameIdx)) return;
            pendingRef.current.add(frameIdx);
            setLoading(true);
            try {
                const imgData = await extractFrameFromVideo(frameIdx, videoInfo.fps);
                frameCacheRef.current.set(frameIdx, imgData);
                if (frameCacheRef.current.size > 60) {
                    const oldest = frameCacheRef.current.keys().next().value;
                    frameCacheRef.current.delete(oldest);
                }
                if (frameIdx === currentFrame) {
                    renderFrame(new ImageData(
                        new Uint8ClampedArray(imgData.data),
                        imgData.width,
                        imgData.height
                    ));
                }
            } catch (err) {
                console.error('Frontend frame extraction error:', err);
            } finally {
                pendingRef.current.delete(frameIdx);
                setLoading(false);
            }
        },
        [videoInfo, currentFrame, renderFrame, extractFrameFromVideo]
    );

    useEffect(() => {
        if (videoId && totalFrames > 0 && currentFrame > 0) {
            if (useFrontendExtraction) {
                loadFrameFromVideo(currentFrame);
            } else {
                loadFrameFromBackend(currentFrame);
            }
        }
    }, [currentFrame, videoId, totalFrames, useFrontendExtraction, loadFrameFromBackend, loadFrameFromVideo]);

    useEffect(() => {
        if (videoId && totalFrames > 0 && currentFrame > 0 && frameCacheRef.current.size > 0) {
            const cached = frameCacheRef.current.get(currentFrame);
            if (cached) {
                renderFrame(new ImageData(
                    new Uint8ClampedArray(cached.data),
                    cached.width,
                    cached.height
                ));
            }
        }
    }, [blockSize, renderFrame, currentFrame, totalFrames, videoId]);

    const pollStatus = useCallback((vid) => {
        const poll = async () => {
            try {
                const resp = await fetch(`${API_BASE}/videos/${vid}/status`);
                const data = await resp.json();
                setExtractProgress(`正在提取帧... ${data.totalFrames} / ~${Math.floor(data.duration * data.fps)}`);
                setTotalFrames(data.totalFrames);
                if (data.ready || data.totalFrames > 0) {
                    setVideoInfo((prev) => ({ ...prev, ...data }));
                    if (data.ready) {
                        setExtracting(false);
                        setExtractProgress('');
                        setCurrentFrame(1);
                        return;
                    }
                }
                setTimeout(poll, 1500);
            } catch {
                setTimeout(poll, 2000);
            }
        };
        poll();
    }, []);

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        frameCacheRef.current.clear();
        pendingRef.current.clear();
        setVideoId(null);
        setVideoInfo(null);
        setCurrentFrame(0);
        setTotalFrames(0);
        setExtracting(true);
        setPlaybackActive(false);

        if (videoObjectUrlRef.current) {
            URL.revokeObjectURL(videoObjectUrlRef.current);
            videoObjectUrlRef.current = null;
        }

        const formData = new FormData();
        formData.append('video', file);

        try {
            const resp = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || 'Upload failed');
            setVideoId(data.videoId);

            if (!data.ffmpegAvailable) {
                setUseFrontendExtraction(true);
                const objectUrl = URL.createObjectURL(file);
                videoObjectUrlRef.current = objectUrl;
                const video = hiddenVideoRef.current;
                if (video) {
                    video.src = objectUrl;
                    video.onloadedmetadata = () => {
                        const fps = 24;
                        const totalF = Math.floor(video.duration * fps);
                        setVideoInfo({
                            fps,
                            width: video.videoWidth,
                            height: video.videoHeight,
                            duration: video.duration,
                        });
                        setTotalFrames(totalF);
                        setExtracting(false);
                        setExtractProgress('');
                        setCurrentFrame(1);
                    };
                    video.onerror = () => {
                        setExtracting(false);
                        alert('无法加载视频文件');
                    };
                }
            } else {
                setUseFrontendExtraction(false);
                setVideoInfo({ fps: data.fps, width: data.width, height: data.height, duration: data.duration });
                pollStatus(data.videoId);
            }
        } catch (err) {
            alert('上传失败: ' + err.message);
            setExtracting(false);
        }
    };

    const handleSliderChange = (e) => {
        const val = parseInt(e.target.value, 10);
        if (val >= 1 && val <= totalFrames) {
            setCurrentFrame(val);
        }
    };

    const handlePlay = () => {
        if (playbackActive) {
            setPlaybackActive(false);
            if (playbackRef.current) cancelAnimationFrame(playbackRef.current);
            return;
        }
        setPlaybackActive(true);
        const fps = videoInfo?.fps || 24;
        const interval = 1000 / fps;
        let lastTime = performance.now();

        const step = (now) => {
            if (!playbackActive && now - lastTime >= interval) {
                lastTime = now;
                setCurrentFrame((prev) => {
                    if (prev >= totalFrames) {
                        setPlaybackActive(false);
                        return 1;
                    }
                    return prev + 1;
                });
            }
            playbackRef.current = requestAnimationFrame(step);
        };

        const stepWrapper = (now) => {
            if (now - lastTime >= interval) {
                lastTime = now;
                setCurrentFrame((prev) => {
                    if (prev >= totalFrames) {
                        setPlaybackActive(false);
                        return 1;
                    }
                    return prev + 1;
                });
            }
            if (document.hidden === false) {
                playbackRef.current = requestAnimationFrame(stepWrapper);
            } else {
                playbackRef.current = requestAnimationFrame(stepWrapper);
            }
        };
        playbackRef.current = requestAnimationFrame(stepWrapper);
    };

    const getFrameUrl = (idx) => `${API_BASE}/frames/${videoId}/${idx}`;

    const formatTime = (seconds) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 100);
        return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    };

    return (
        <div className="app">
            <video
                ref={hiddenVideoRef}
                style={{ display: 'none' }}
                preload="auto"
                muted
                playsInline
            />

            <header className="app-header">
                <h1>Pixel Frame</h1>
                <p className="subtitle">上传视频 · 像素风滤镜 · 实时预览</p>
            </header>

            <div className="main-content">
                <div className="canvas-area">
                    <canvas ref={canvasRef} className="frame-canvas" />
                    {!videoId && !extracting && (
                        <div className="canvas-placeholder">
                            <div className="placeholder-icon">🎬</div>
                            <p>上传一段视频开始体验</p>
                        </div>
                    )}
                    {extracting && (
                        <div className="canvas-placeholder">
                            <div className="spinner" />
                            <p>{extractProgress || '正在处理视频...'}</p>
                        </div>
                    )}
                    {loading && !dragging && (
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
                                <span className="info-value">{videoInfo.width}×{videoInfo.height}</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">帧率</span>
                                <span className="info-value">{videoInfo.fps} FPS</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">时长</span>
                                <span className="info-value">{videoInfo.duration?.toFixed(2)}s</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">总帧数</span>
                                <span className="info-value">{totalFrames}</span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">滤镜引擎</span>
                                <span className={`info-value ${wasmReady ? 'status-ok' : 'status-warn'}`}>
                                    {filterMode}
                                </span>
                            </div>
                            <div className="info-row">
                                <span className="info-label">帧提取</span>
                                <span className={`info-value ${useFrontendExtraction ? 'status-warn' : 'status-ok'}`}>
                                    {useFrontendExtraction ? '前端降级' : '后端 ffmpeg'}
                                </span>
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
                                <span>帧 {currentFrame} / {totalFrames}</span>
                                <span className="time-display">
                                    {formatTime(currentFrame / (videoInfo?.fps || 24))}
                                </span>
                            </div>
                            <input
                                ref={sliderRef}
                                type="range"
                                min={1}
                                max={totalFrames}
                                value={currentFrame}
                                onChange={handleSliderChange}
                                onMouseDown={() => setDragging(true)}
                                onMouseUp={() => setDragging(false)}
                                onTouchStart={() => setDragging(true)}
                                onTouchEnd={() => setDragging(false)}
                                className="timeline-slider"
                            />
                            <div className="timeline-thumbnails">
                                {Array.from({ length: Math.min(7, totalFrames) }, (_, i) => {
                                    const thumbFrame = Math.floor((i / 6) * totalFrames) + 1;
                                    if (useFrontendExtraction) return null;
                                    return (
                                        <img
                                            key={i}
                                            src={getFrameUrl(thumbFrame)}
                                            className="thumbnail"
                                            alt={`Frame ${thumbFrame}`}
                                            loading="lazy"
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {videoId && !extracting && (
                        <div className="frame-nav">
                            <button
                                className="nav-btn"
                                disabled={currentFrame <= 1}
                                onClick={() => setCurrentFrame((f) => Math.max(1, f - 1))}
                            >
                                ◀ 上一帧
                            </button>
                            <button
                                className={`nav-btn play-btn ${playbackActive ? 'active' : ''}`}
                                onClick={handlePlay}
                                disabled={totalFrames <= 0}
                            >
                                {playbackActive ? '⏸ 暂停' : '▶ 播放'}
                            </button>
                            <button
                                className="nav-btn"
                                disabled={currentFrame >= totalFrames}
                                onClick={() => setCurrentFrame((f) => Math.min(totalFrames, f + 1))}
                            >
                                下一帧 ▶
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <footer className="app-footer">
                Rust → WebAssembly 像素风滤镜 · 当前 {blockSize}×{blockSize} 像素块
            </footer>
        </div>
    );
}

export default App;
