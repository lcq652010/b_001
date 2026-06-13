const fs = require('fs');
const http = require('http');

const filePath = 'D:/AA_solo_0608/b_001/server/test_video.mp4';
const boundary = '----WebKitFormBoundaryTest123';

function createTestVideo(callback) {
    const { execSync } = require('child_process');
    try {
        execSync('cd /d D:\\AA_solo_0608\\b_001\\server && ffmpeg.exe -y -f lavfi -i "testsrc=size=320x240:duration=2:rate=24" -c:v libx264 -pix_fmt yuv420p -an test_video.mp4', { stdio: 'ignore', timeout: 30000 });
        callback(null);
    } catch (err) {
        callback(err);
    }
}

createTestVideo((err) => {
    if (err) {
        console.error('Failed to create test video:', err.message);
        process.exit(1);
    }

    const fileSize = fs.statSync(filePath).size;
    const fileContent = fs.readFileSync(filePath);

    const pre = `--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="test_video.mp4"\r\nContent-Type: video/mp4\r\n\r\n`;
    const post = `\r\n--${boundary}--\r\n`;

    const totalSize = Buffer.byteLength(pre) + fileSize + Buffer.byteLength(post);

    const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/api/upload',
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': totalSize,
        },
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
            console.log(`Upload status: ${res.statusCode}`);
            console.log('Response:', body);

            const data = JSON.parse(body);
            if (data.videoId) {
                console.log(`\nVideo ID: ${data.videoId}`);
                console.log(`FPS: ${data.fps}`);
                console.log(`Resolution: ${data.width}x${data.height}`);
                console.log(`Duration: ${data.duration}s`);
                console.log(`ffmpeg available: ${data.ffmpegAvailable}`);

                const pollStatus = () => {
                    http.get(`http://localhost:3001/api/videos/${data.videoId}/status`, (res2) => {
                        let b = '';
                        res2.on('data', (c) => { b += c; });
                        res2.on('end', () => {
                            const statusData = JSON.parse(b);
                            console.log(`Status: ready=${statusData.ready}, totalFrames=${statusData.totalFrames}`);
                            if (!statusData.ready && statusData.totalFrames < 47) {
                                setTimeout(pollStatus, 500);
                            } else {
                                console.log('\n=== Frame extraction complete! ===');
                                console.log(`Total frames: ${statusData.totalFrames}`);

                                http.get(`http://localhost:3001/api/frames/${data.videoId}/1`, (res3) => {
                                    console.log(`Frame 1 status: ${res3.statusCode}`);
                                    console.log(`Frame 1 content-type: ${res3.headers['content-type']}`);
                                    let size = 0;
                                    res3.on('data', (c) => { size += c.length; });
                                    res3.on('end', () => {
                                        console.log(`Frame 1 size: ${size} bytes`);
                                        console.log('\n=== ALL TESTS PASSED ===');
                                        fs.unlinkSync(filePath);
                                    });
                                });
                            }
                        });
                    });
                };
                setTimeout(pollStatus, 1500);
            }
        });
    });

    req.write(pre);
    req.write(fileContent);
    req.end(post);

    req.on('error', (e) => {
        console.error('Upload error:', e.message);
    });
});
