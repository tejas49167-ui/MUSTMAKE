export function getSmartCameraPromptState(enabled, previewFullscreen, lifecycle) {
    if (!enabled || previewFullscreen) return null;
    if (lifecycle === "idle" || lifecycle === "initializing") return "preparing";
    if (lifecycle === "running") return "scroll";
    return null;
}

export function createSmartCameraPreview({
    preview,
    previewSlot,
    prompt,
    placeholder,
    monitor,
    smartOverlay,
    overlayNodes,
    resizeCanvas,
    getLifecycle,
    hasLandmarker,
    isDisposed,
    signal
}) {
    const overlaySlots = overlayNodes.filter(Boolean).map(node => {
        const marker = document.createComment("smart camera overlay position");
        node.parentNode.insertBefore(marker, node);
        return { marker, node };
    });

    function findScrollContainer(element) {
        let ancestor = element.parentElement;

        while (
            ancestor &&
            ancestor !== document.body &&
            ancestor !== document.documentElement
        ) {
            const style = window.getComputedStyle(ancestor);
            const canScroll = /(auto|scroll|overlay)/.test(style.overflowY);
            if (canScroll && ancestor.scrollHeight > ancestor.clientHeight + 1) {
                return ancestor;
            }
            ancestor = ancestor.parentElement;
        }

        return document.scrollingElement || document.documentElement;
    }

    const scrollContainer = findScrollContainer(previewSlot);
    let enabled = false;
    let scrollArmed = false;
    let lastScrollPosition = 0;
    let scrollFrame = null;
    let previewFixed = false;
    let previewTargetFullscreen = false;
    let previewTransitioning = false;
    let previewTransitionGeneration = 0;
    let previewTransitionTimer = null;

    function getScrollPosition() {
        if (
            scrollContainer === document.scrollingElement ||
            scrollContainer === document.documentElement ||
            scrollContainer === document.body
        ) {
            return window.scrollY || scrollContainer.scrollTop || 0;
        }
        return scrollContainer.scrollTop;
    }

    function getVisibleViewport() {
        const viewport = window.visualViewport;
        return {
            left: viewport?.offsetLeft ?? 0,
            top: viewport?.offsetTop ?? 0,
            width: viewport?.width ?? window.innerWidth,
            height: viewport?.height ?? window.innerHeight
        };
    }

    function setPreviewGeometry(rect) {
        preview.style.left = `${rect.left}px`;
        preview.style.top = `${rect.top}px`;
        preview.style.width = `${rect.width}px`;
        preview.style.height = `${rect.height}px`;
    }

    function getPreviewTransform(from, to) {
        const scaleX = from.width / to.width;
        const scaleY = from.height / to.height;
        const offsetX = from.left - to.left;
        const offsetY = from.top - to.top;
        return `translate(${offsetX}px, ${offsetY}px) scale(${scaleX}, ${scaleY})`;
    }

    function refresh() {
        preview.dataset.smartCameraMode = String(enabled);

        const promptState = getSmartCameraPromptState(
            enabled,
            previewTargetFullscreen,
            getLifecycle()
        );
        const showPreparation = promptState === "preparing";
        const showScrollPrompt = promptState === "scroll";

        if (promptState === "preparing") {
            prompt.textContent = "Preparing camera...";
        } else if (promptState === "scroll") {
            prompt.textContent = "Scroll ↓";
        }
        prompt.hidden = !showPreparation && !showScrollPrompt;
        placeholder.hidden = enabled
            ? !showPreparation && !showScrollPrompt
            : Boolean(hasLandmarker());
    }

    function getFullscreenPreviewGeometry() {
        return getVisibleViewport();
    }

    function restoreOverlayNodes() {
        overlaySlots.forEach(({ marker, node }) => {
            if (marker.parentNode) {
                marker.parentNode.insertBefore(node, marker.nextSibling);
            }
        });
    }

    function finishPreviewTransition(generation) {
        if (generation !== previewTransitionGeneration || !previewTransitioning) {
            return;
        }

        clearTimeout(previewTransitionTimer);
        previewTransitionTimer = null;
        previewTransitioning = false;
        preview.style.removeProperty("transform");

        if (previewTargetFullscreen) {
            preview.classList.add("smart-camera-visible");
            document.body.classList.add("smart-camera-fullscreen");
        } else {
            previewSlot.append(preview);
            preview.classList.remove(
                "is-fixed",
                "is-fullscreen",
                "smart-camera-visible"
            );
            ["left", "top", "width", "height", "transition"].forEach(property => {
                preview.style.removeProperty(property);
            });
            previewFixed = false;
            document.body.classList.remove("smart-camera-fullscreen");
            if (!enabled) restoreOverlayNodes();
        }

        refresh();
        resizeCanvas();
    }

    function transitionPreview(fullscreen) {
        if (previewTargetFullscreen === fullscreen) return;

        if (!fullscreen) {
            previewTargetFullscreen = false;
            previewTransitionGeneration += 1;
            const generation = previewTransitionGeneration;
            clearTimeout(previewTransitionTimer);
            previewTransitionTimer = null;
            previewTransitioning = true;
            document.body.classList.remove("smart-camera-fullscreen");
            refresh();
            finishPreviewTransition(generation);
            return;
        }

        const current = preview.getBoundingClientRect();
        if (!current.width || !current.height) return;

        previewTargetFullscreen = fullscreen;
        previewTransitionGeneration += 1;
        const generation = previewTransitionGeneration;
        clearTimeout(previewTransitionTimer);
        previewTransitioning = true;
        refresh();

        preview.style.transition = "none";
        preview.style.transform = "none";
        setPreviewGeometry(current);
        if (!previewFixed) {
            preview.classList.add("is-fixed");
            previewFixed = true;
            document.body.append(preview);
        }
        void preview.offsetWidth;

        preview.style.transition =
            "border-radius 360ms ease, border-color 300ms ease, box-shadow 300ms ease";
        if (fullscreen) preview.classList.add("smart-camera-visible");
        if (fullscreen) preview.classList.add("is-fullscreen");
        const target = getFullscreenPreviewGeometry();
        setPreviewGeometry(target);
        preview.style.transform = getPreviewTransform(current, target);
        void preview.offsetWidth;
        preview.style.removeProperty("transition");
        void preview.offsetWidth;

        requestAnimationFrame(() => {
            if (isDisposed() || generation !== previewTransitionGeneration) return;
            preview.style.removeProperty("transform");
        });

        previewTransitionTimer = window.setTimeout(
            () => finishPreviewTransition(generation),
            420
        );
    }

    function retargetPreviewGeometry(target) {
        if (!previewFixed || !previewTransitioning) return;
        const generation = previewTransitionGeneration;
        const current = preview.getBoundingClientRect();
        preview.style.transition = "none";
        preview.style.transform = "none";
        setPreviewGeometry(current);
        void preview.offsetWidth;
        setPreviewGeometry(target);
        preview.style.transform = getPreviewTransform(current, target);
        void preview.offsetWidth;
        preview.style.removeProperty("transition");
        void preview.offsetWidth;
        requestAnimationFrame(() => {
            if (
                isDisposed() ||
                generation !== previewTransitionGeneration ||
                !previewTransitioning
            ) {
                return;
            }
            preview.style.removeProperty("transform");
        });
        clearTimeout(previewTransitionTimer);
        previewTransitionTimer = window.setTimeout(
            () => finishPreviewTransition(generation),
            420
        );
    }

    function retargetExpandedPreview() {
        if (previewTargetFullscreen) return;
        retargetPreviewGeometry(previewSlot.getBoundingClientRect());
    }

    function updateOnScroll() {
        if (!enabled || getLifecycle() !== "running") {
            lastScrollPosition = getScrollPosition();
            return;
        }

        const currentScrollPosition = Math.max(0, getScrollPosition());
        if (currentScrollPosition > lastScrollPosition) scrollArmed = true;
        lastScrollPosition = currentScrollPosition;
        if (!scrollArmed) return;

        const shouldBeFullscreen = currentScrollPosition > 0.5;
        if (!shouldBeFullscreen && previewFixed && !previewTargetFullscreen) {
            retargetExpandedPreview();
        } else {
            transitionPreview(shouldBeFullscreen);
        }
    }

    function scheduleScrollUpdate() {
        if (scrollFrame != null) return;

        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = null;
            updateOnScroll();
        });
    }

    function handleWheel(event) {
        if (
            !enabled ||
            getLifecycle() !== "running" ||
            event.ctrlKey ||
            event.deltaY === 0 ||
            scrollContainer.scrollHeight > scrollContainer.clientHeight + 1
        ) {
            return;
        }

        transitionPreview(event.deltaY > 0);
    }

    function handleTransitionEnd(event) {
        if (
            event.target === preview &&
            event.propertyName === "transform"
        ) {
            finishPreviewTransition(previewTransitionGeneration);
        }
    }

    function handleWindowResize() {
        if (previewFixed && previewTargetFullscreen) {
            if (previewTransitioning) {
                retargetPreviewGeometry(getFullscreenPreviewGeometry());
            } else {
                preview.style.transition = "none";
                setPreviewGeometry(getFullscreenPreviewGeometry());
                void preview.offsetWidth;
                preview.style.removeProperty("transition");
            }
        } else {
            retargetExpandedPreview();
        }
        resizeCanvas();
    }

    function handleVisualViewportScroll() {
        if (!previewFixed || !previewTargetFullscreen || previewTransitioning) {
            return;
        }

        preview.style.transition = "none";
        setPreviewGeometry(getFullscreenPreviewGeometry());
        resizeCanvas();
        void preview.offsetWidth;
        preview.style.removeProperty("transition");
    }

    function setEnabled(value) {
        const nextEnabled = Boolean(value);
        if (enabled === nextEnabled) return;

        enabled = nextEnabled;
        monitor.dataset.smartCameraMode = String(nextEnabled);
        scrollArmed = false;
        lastScrollPosition = getScrollPosition();
        refresh();

        if (nextEnabled) {
            overlaySlots.forEach(({ node }) => smartOverlay.append(node));
        } else if (previewTargetFullscreen || previewFixed) {
            transitionPreview(false);
        } else {
            restoreOverlayNodes();
        }
    }

    function setLifecycle(state) {
        refresh();

        if (state === "running") {
            scrollArmed = false;
            lastScrollPosition = getScrollPosition();
        } else if (previewTargetFullscreen) {
            transitionPreview(false);
        }
    }

    function dispose() {
        if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
        clearTimeout(previewTransitionTimer);
        previewTransitionTimer = null;
        previewSlot.append(preview);
        preview.classList.remove(
            "is-fixed",
            "is-fullscreen",
            "smart-camera-visible"
        );
        ["left", "top", "width", "height", "transition"].forEach(property => {
            preview.style.removeProperty(property);
        });
        previewFixed = false;
        document.body.classList.remove("smart-camera-fullscreen");
    }

    preview.addEventListener("transitionend", handleTransitionEnd, { signal });
    window.addEventListener("resize", handleWindowResize, { signal });
    window.visualViewport?.addEventListener("resize", handleWindowResize, { signal });
    window.visualViewport?.addEventListener("scroll", handleVisualViewportScroll, {
        signal
    });
    window.addEventListener("scroll", scheduleScrollUpdate, {
        passive: true,
        signal
    });
    scrollContainer.addEventListener("scroll", scheduleScrollUpdate, {
        passive: true,
        signal
    });
    document.addEventListener("scroll", scheduleScrollUpdate, {
        capture: true,
        passive: true,
        signal
    });
    document.addEventListener("wheel", handleWheel, { passive: true, signal });

    monitor.dataset.smartCameraMode = "false";

    return {
        dispose,
        isTransitioning: () => previewTransitioning,
        refresh,
        setEnabled,
        setLifecycle
    };
}
