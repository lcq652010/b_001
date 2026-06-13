const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const FRAMES_DIR = path.join(__dirname, 'frames');
const LOCAL_FFMPEG = path.join(__dirname, 'ffmpeg.exe');
const LOCAL_FFPROBE = path.join(__dirname, 'ffprobe.exe');

[UPLOAD_DIR, FRAMES_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let ffmpegAvailable = false;
let ffmpegPath = null;
let ffprobePath = null;

if (fs.existsSync(LOCAL_FFMPEG) && fs.existsSync(LOCAL_FFPROBE)) {
    ffmpegPath = LOCAL_FFMPEG;
    ffprobePath = LOCAL_FFPROBE;
    ffmpeg.setFfmpegPath(ffmpegPath);
    ffmpeg.setFfprobePath(ffprobePath);
    ffmpegAvailable = true;
    console.log(`Using local ffmpeg: ${ffmpegPath}`);
} else {
    try {
        const { execSync } = require('child_process');
        execSync('ffmpeg -version', { stdio: 'ignore', timeout: 5000 });
        ffmpegAvailable = true;
        console.log('Using system ffmpeg');
    } catch {
        try {
            const ffmpegStatic = require('ffmpeg-static');
            if (ffmpegStatic) {
                ffmpeg.setFfmpegPath(ffmpegStatic);
                ffmpegAvailable = true;
                ffmpegPath = ffmpegStatic;
                console.log('Using ffmpeg-static');
            }
        } catch {}
    }
}

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    },
});

const upload = multer({
    storage,
    fileFilter: (_req, file, cb) => {
        const allowed = ['.mp4', '.avi', '.mov', '.mkv', '.webm'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowed.includes(ext));
    },
    limits: { fileSize: 500 * 1024 * 1024 },
});

const videoMeta = {};

app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', ffmpeg: ffmpegAvailable });
});

app.post('/api/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No video file provided' });
    }

    const videoId = path.basename(req.file.filename, path.extname(req.file.filename));
    const videoPath = req.file.path;
    const outputDir = path.join(FRAMES_DIR, videoId);

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    videoMeta[videoId] = {
        videoPath,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        fps: 0,
        width: 0,
        height: 0,
        duration: 0,
        totalFrames: 0,
    };

    if (!ffmpegAvailable) {
        return res.json({
            videoId,
            fps: 0,
            width: 0,
            height: 0,
            duration: 0,
            ffmpegAvailable: false,
            message: 'Video uploaded. ffmpeg not available on server, will use frontend frame extraction.',
        });
    }

    ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
            console.error('ffprobe error:', err.message);
            return res.json({
                videoId,
                fps: 0,
                width: 0,
                height: 0,
                duration: 0,
                ffmpegAvailable: true,
                ffprobeError: true,
                message: 'Video uploaded but probe failed: ' + err.message,
            });
        }

        const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
        if (!videoStream) {
            return res.json({
                videoId,
                fps: 0,
                width: 0,
                height: 0,
                duration: 0,
                ffmpegAvailable: true,
                message: 'No video stream found',
            });
        }

        const fps = evalFps(videoStream.r_frame_rate);
        const width = videoStream.width;
        const height = videoStream.height;
        const duration = parseFloat(videoStream.duration || metadata.format.duration || '0');

        videoMeta[videoId] = { ...videoMeta[videoId], fps, width, height, duration };

        const framePattern = path.join(outputDir, 'frame_%05d.png');

        ffmpeg(videoPath)
            .output(framePattern)
            .noAudio()
            .on('end', () => {
                const frames = fs.readdirSync(outputDir).filter((f) => f.endsWith('.png')).sort();
                videoMeta[videoId].totalFrames = frames.length;
                console.log(`Video ${videoId}: extracted ${frames.length} frames`);
            })
            .on('error', (extractErr) => {
                console.error('Frame extraction error:', extractErr.message);
            })
            .run();

        res.json({
            videoId,
            fps,
            width,
            height,
            duration,
            ffmpegAvailable: true,
            message: 'Video uploaded, frame extraction started',
        });
    });
});

app.get('/api/videos/:videoId/video', (req, res) => {
    const { videoId } = req.params;
    const meta = videoMeta[videoId];
    if (!meta || !meta.videoPath) {
        return res.status(404).json({ error: 'Video not found' });
    }
    if (!fs.existsSync(meta.videoPath)) {
        return res.status(404).json({ error: 'Video file not found' });
    }
    res.sendFile(meta.videoPath);
});

app.get('/api/videos/:videoId/status', (req, res) => {
    const { videoId } = req.params;
    const meta = videoMeta[videoId];
    if (!meta) return res.status(404).json({ error: 'Video not found' });

    const outputDir = path.join(FRAMES_DIR, videoId);
    const frames = fs.existsSync(outputDir)
        ? fs.readdirSync(outputDir).filter((f) => f.endsWith('.png'))
        : [];
    const totalFrames = frames.length;

    const done = meta.duration > 0 ? totalFrames >= Math.floor(meta.duration * meta.fps) - 2 : totalFrames > 0;

    res.json({
        videoId,
        fps: meta.fps,
        width: meta.width,
        height: meta.height,
        duration: meta.duration,
        totalFrames,
        ready: done,
        ffmpegAvailable,
    });
});

app.get('/api/frames/:videoId/:frameIndex', (req, res) => {
    const { videoId, frameIndex } = req.params;
    const idx = parseInt(frameIndex, 10);

    const outputDir = path.join(FRAMES_DIR, videoId);
    if (!fs.existsSync(outputDir)) {
        return res.status(404).json({ error: 'Video frames not found' });
    }

    const frameFile = path.join(outputDir, `frame_${String(idx).padStart(5, '0')}.png`);
    if (!fs.existsSync(frameFile)) {
        return res.status(404).json({ error: `Frame ${idx} not found` });
    }

    res.sendFile(frameFile);
});

app.get('/api/videos/:videoId/frames', (req, res) => {
    const { videoId } = req.params;
    const outputDir = path.join(FRAMES_DIR, videoId);

    if (!fs.existsSync(outputDir)) {
        return res.status(404).json({ error: 'Video frames not found' });
    }

    const frames = fs.readdirSync(outputDir).filter((f) => f.endsWith('.png')).sort();
    res.json({ totalFrames: frames.length });
});

app.use('/frames', express.static(FRAMES_DIR));

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`ffmpeg available: ${ffmpegAvailable}`);
});

function evalFps(rFrameRate) {
    if (!rFrameRate) return 30;
    const parts = rFrameRate.split('/');
    if (parts.length === 2) {
        const num = parseFloat(parts[0]);
        const den = parseFloat(parts[1]);
        return den > 0 ? Math.round(num / den) : 30;
    }
    return parseInt(rFrameRate, 10) || 30;
}
