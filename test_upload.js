const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const http = require('http');

const videoPath = path.join(__dirname, 'server', 'test_video.mp4');

function uploadVideo() {
    return new Promise((resolve, reject) => {
        const form = new FormData();
        form.append('video', fs.createReadStream(videoPath), {
            filename: 'test_video.mp4',
            contentType: 'video/mp4',
        });

        const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/api/upload',
            method: 'POST',
            headers: form.getHeaders(),
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        form.pipe(req);
    });
}

function checkStatus(videoId) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:3001/api/videos/${videoId}/status`, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function checkFrame(videoId, frameIdx) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:3001/api/frames/${videoId}/${frameIdx}`, (res) => {
            resolve({
                statusCode: res.statusCode,
                contentType: res.headers['content-type'],
                contentLength: res.headers['content-length'],
            });
        }).on('error', reject);
    });
}

async function main() {
    try {
        console.log('=== Step 1: Upload video ===');
        const uploadResult = await uploadVideo();
        console.log('Upload result:', JSON.stringify(uploadResult, null, 2));

        if (!uploadResult.videoId) {
            console.error('No videoId returned');
            process.exit(1);
        }

        const videoId = uploadResult.videoId;
        console.log('\n=== Step 2: Poll status ===');

        for (let i = 0; i < 15; i++) {
            const status = await checkStatus(videoId);
            console.log(`Poll ${i + 1}:`, JSON.stringify(status, null, 2));

            if (status.ready || status.status === 'ready') {
                console.log('\n=== Step 3: Check frames ===');
                for (let f = 1; f <= Math.min(5, status.totalFrames); f++) {
                    const frameRes = await checkFrame(videoId, f);
                    console.log(`Frame ${f}:`, JSON.stringify(frameRes));
                }

                if (status.totalFrames > 0) {
                    const lastFrame = await checkFrame(videoId, status.totalFrames);
                    console.log(`Frame ${status.totalFrames} (last):`, JSON.stringify(lastFrame));
                }
                break;
            }

            await new Promise(r => setTimeout(r, 1000));
        }

        console.log('\n=== Done ===');
    } catch (err) {
        console.error('Error:', err.message);
    }
}

main();
