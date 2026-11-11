const CONNECTIONS = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
    [27, 29], [29, 31], [24, 26], [26, 28], [28, 30], [30, 32]
];

export function createPoseRenderer({
    canvas,
    video,
    preview,
    previewSlot,
    isTransitioning,
    isDisposed
}) {
    const context = canvas.getContext("2d");

    function clear() {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function resize() {
        if (isTransitioning()) return;

        const bounds = canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;

        const ratio = Math.max(1, window.devicePixelRatio || 1);
        const pixelWidth = Math.max(1, Math.round(bounds.width * ratio));
        const pixelHeight = Math.max(1, Math.round(bounds.height * ratio));
        const sizeChanged = canvas.width !== pixelWidth || canvas.height !== pixelHeight;

        if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
        if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

        context.setTransform(
            pixelWidth / bounds.width,
            0,
            0,
            pixelHeight / bounds.height,
            0,
            0
        );

        if (sizeChanged) clear();
    }

    function updateAspectRatio() {
        if (!video.videoWidth || !video.videoHeight) return;

        const aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        preview.style.aspectRatio = aspectRatio;
        previewSlot.style.aspectRatio = aspectRatio;

        requestAnimationFrame(() => {
            if (!isDisposed()) resize();
        });
    }

    function draw(landmarks) {
        resize();
        clear();

        if (!landmarks?.length || !video.videoWidth || !video.videoHeight) return;

        const bounds = canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height || !canvas.width || !canvas.height) return;

        const fitScale = preview.classList.contains("is-fullscreen") ? Math.max : Math.min;
        const scale = fitScale(
            bounds.width / video.videoWidth,
            bounds.height / video.videoHeight
        );
        const drawnWidth = video.videoWidth * scale;
        const drawnHeight = video.videoHeight * scale;
        const offsetX = (bounds.width - drawnWidth) / 2;
        const offsetY = (bounds.height - drawnHeight) / 2;
        const scaleX = canvas.width / bounds.width;
        const scaleY = canvas.height / bounds.height;

        context.save();
        context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
        context.lineWidth = 3;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(74, 222, 128, 0.95)";
        context.fillStyle = "#f8fafc";

        const visibilityOf = landmark => landmark?.visibility ?? landmark?.presence ?? 1;
        const point = index => {
            const landmark = landmarks[index];
            if (!landmark || visibilityOf(landmark) < 0.35) return null;

            return {
                x: landmark.x * drawnWidth + offsetX,
                y: landmark.y * drawnHeight + offsetY
            };
        };

        for (const [fromIndex, toIndex] of CONNECTIONS) {
            const from = point(fromIndex);
            const to = point(toIndex);
            if (!from || !to) continue;

            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
        }

        landmarks.forEach((landmark, index) => {
            if (visibilityOf(landmark) < 0.45) return;
            const position = point(index);
            if (!position) return;

            context.beginPath();
            context.arc(position.x, position.y, 3.5, 0, Math.PI * 2);
            context.fill();
        });

        context.restore();
    }

    return { clear, draw, resize, updateAspectRatio };
}
