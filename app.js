import { menuConfig } from "./data/menuConfig.js";

let currentFrame = 1;
let isDragging = false;
let lastX = 0;
let activeItem = null;
let activeData = null;
let currentFolder = '';
let visibleStructures = {};
const vContainer = document.getElementById('viewer-container');
const probe = document.getElementById('probe-handle');
const beamCanvas = document.getElementById('beam-canvas');
const beamCtx = beamCanvas.getContext('2d');
let ticking = false;
let isHoldingProbe = false;
let probeMoveAnimationFrame = null;
let lastProbeMovePosition = null;
let tiltSlider = null;
let isAdjustingTiltSlider = false;

// Set probe position based on percentages relative to the active image area when available.
function setProbePositionFromImagePercent(xPercent, yPercent) {
    if (!vContainer || !probe) return;
    const containerRect = vContainer.getBoundingClientRect();
    const activeImg = document.querySelector('#viewer img.active');
    if (activeImg && activeImg.clientWidth > 0) {
        const imgRect = activeImg.getBoundingClientRect();
        const px = imgRect.left - containerRect.left + (xPercent / 100) * imgRect.width;
        const py = imgRect.top - containerRect.top + (yPercent / 100) * imgRect.height;
        const leftPct = (px / containerRect.width) * 100;
        const topPct = (py / containerRect.height) * 100;
        probe.style.left = leftPct + '%';
        probe.style.top = topPct + '%';
    } else {
        // fallback: set as percent of container
        probe.style.left = xPercent + '%';
        probe.style.top = yPercent + '%';
    }
}

function parseHexToRgb(hex) {
    const shorthand = /^#([a-f\d])([a-f\d])([a-f\d])$/i;
    const normalized = hex.replace(shorthand, (m, r, g, b) => `#${r}${r}${g}${g}${b}${b}`);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
    return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : null;
}

function normalizeFillColor(color, border) {
    if (!color) color = border;
    if (!color) return 'rgba(255,255,255,0.2)';

    const rgbaMatch = color.match(/rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d(?:\.\d+)?)\s*\)/i);
    if (rgbaMatch && parseFloat(rgbaMatch[4]) === 0) {
        return `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, 0.2)`;
    }

    const rgbMatch = color.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/i);
    if (rgbMatch) return color;

    const hexRgb = parseHexToRgb(color);
    if (hexRgb) return `rgba(${hexRgb[0]}, ${hexRgb[1]}, ${hexRgb[2]}, 0.2)`;

    return color;
}

function getAnnotationFrameRange(sData) {
    if (!sData || !Array.isArray(sData.points) || sData.points.length === 0) return null;
    const frames = sData.points.map(p => p.frame).filter(f => typeof f === 'number');
    if (frames.length === 0) return null;
    return [Math.min(...frames), Math.max(...frames)];
}

function applyStructureButtonStyle(btn, sData) {
    const borderColor = sData.border || sData.color || '#888';
    const fillColor = normalizeFillColor(sData.color, sData.border);
    btn.style.backgroundColor = fillColor;
    btn.style.border = `2px solid ${borderColor}`;
    btn.style.color = '#fff';
    btn.style.textShadow = '0 0 1px rgba(0, 0, 0, 0.7)';
    btn.dataset.borderColor = borderColor;
    btn.style.boxShadow = btn.classList.contains('active') ? `0 0 10px ${borderColor}` : 'none';
}

function initMenu() {
    const container = document.getElementById('menu-container');
    container.innerHTML = '';
    menuConfig.forEach((cat, idx) => {
        const title = document.createElement('div');
        title.className = 'category-title';
        title.innerText = cat.category;

        title.onclick = () => {
            if (cat.category === 'ABDOMEN') {
                openAbdomenNav();
            } else {
                const list = document.getElementById(`cat-${idx}`);
                list.style.display = list.style.display === 'block' ? 'none' : 'block';
            }
        };

        const list = document.createElement('div');
        list.id = `cat-${idx}`;
        list.className = 'item-list';

        cat.items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'item';
            div.innerText = item.title;
            div.title = `構造物：${item.structures.join('、')}`;
            div.onclick = () => openScanner(item);
            list.appendChild(div);
        });

        container.appendChild(title);
        container.appendChild(list);
    });
}

async function loadDataForItem(item) {
    const folder = item.folder;
    if (folder.startsWith('abs')) {
        const module = await import(`./data/abdomen/${folder}.js`);
        return module.default || module;
    }
    if (folder === 'median_nerve_200' || folder === 'ulnar' || folder === 'radial') {
        const module = await import(`./data/upperLimb/${folder}.js`);
        return module.default || module;
    }
    if (folder === 'leg_upper' || folder === 'leg_lower') {
        const module = await import(`./data/lowerLimb/${folder}.js`);
        return module.default || module;
    }
    if (folder === 'all') {
        const module = await import("./data/allData.js");
        return module.allData || module.default || module;
    }
    return null;
}

async function openScanner(item) {
    const bCanvas = document.getElementById('beam-canvas');
    const dCanvas = document.getElementById('drawingCanvas');
    if (bCanvas) bCanvas.getContext('2d').clearRect(0, 0, bCanvas.width, bCanvas.height);
    if (dCanvas) dCanvas.getContext('2d').clearRect(0, 0, dCanvas.width, dCanvas.height);

    const nav = document.getElementById('abdomen-nav');
    if (nav) nav.style.display = 'none';

    activeItem = item;
    activeItem.showGuide = false;
    visibleStructures = {};
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('echo-detail').style.display = 'flex';
    document.getElementById('echo-title').innerText = item.title;
    document.getElementById('structures-subtitle').innerText = `構造物：${item.structures.join('、')}`;

    currentFolder = item.folder;
    currentFrame = 1;
    activeData = null;

    const btnGroup = document.getElementById('button-group');
    btnGroup.innerHTML = '';

    loadImages(item.folder);
    setTimeout(initProbe, 50);

    try {
        activeData = await loadDataForItem(item);
    } catch (error) {
        console.error('Data load failed:', error);
        activeData = {};
    }

    if (probe && item.start) {
        setProbePositionFromImagePercent(item.start.x, item.start.y);
        probe.style.transform = `translate(-50%, -50%) rotate(${item.rotate || 0}deg)`;
    }

    const caseData = activeData?.[item.title] || {};
    item.structures.forEach(sName => {
        const btn = document.createElement('button');
        btn.dataset.structure = sName;
        btn.className = 'toggle-btn';
        btn.innerText = sName.toUpperCase();
        visibleStructures[sName] = false;

        const sData = caseData[sName];
        if (sData) {
            // 最初は色を適用しない（アノテーションがOFFなので）
            btn.dataset.sData = JSON.stringify(sData);
            const range = getAnnotationFrameRange(sData);
            btn.style.display = range && currentFrame >= range[0] && currentFrame <= range[1] ? 'block' : 'none';
        } else {
            btn.style.display = 'none';
        }

        btn.onclick = () => {
            visibleStructures[sName] = !visibleStructures[sName];
            btn.classList.toggle('active');
            
            if (btn.classList.contains('active')) {
                // activeの時：色と光を適用
                applyStructureButtonStyle(btn, sData);
            } else {
                // activeでない時：色をリセット
                btn.style.backgroundColor = '';
                btn.style.border = '1px solid #444';
                btn.style.boxShadow = 'none';
                btn.style.textShadow = '';
            }
            draw(currentFrame);
        };
        btnGroup.appendChild(btn);
    });

    // Tilt mode: add an on-screen slider control to make tilt adjustments easier
    const scanControls = document.querySelector('.scan-controls');
    // remove existing tilt control if any
    const existingTilt = document.getElementById('tilt-control');
    if (existingTilt) existingTilt.remove();

    if (item.type === 'tilt' && scanControls) {
        const tiltWrap = document.createElement('div');
        tiltWrap.id = 'tilt-control';
        tiltWrap.style.display = 'flex';
        tiltWrap.style.flexDirection = 'column';
        tiltWrap.style.alignItems = 'center';
        tiltWrap.style.width = '90%';
        tiltWrap.style.margin = '6px auto';

        const label = document.createElement('div');
        label.innerText = 'Tilt Control';
        label.style.color = '#ccc';
        label.style.fontSize = '0.8rem';
        label.style.marginBottom = '6px';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = 100;
        slider.value = 0;
        slider.id = 'tilt-slider';
        slider.style.width = '100%';

        slider.addEventListener('input', (ev) => {
            if (!activeItem) return;
            isAdjustingTiltSlider = true;
            const v = parseInt(ev.target.value, 10) / 100;
            let r = Math.max(0, Math.min(1, v));

            if (activeItem.axis === 'z') {
                const tiltX = 60 - r * 120;
                probe.style.transform = `translate(-50%, 0%) rotate(${activeItem.baseRotate}deg) rotateX(${tiltX}deg)`;
            } else {
                const clampedOffset = activeItem.startAngle + r * (activeItem.endAngle - activeItem.startAngle);
                const finalDisplayAngle = (activeItem.baseRotate - 90) + clampedOffset;
                probe.style.transform = `translate(-50%, 0%) rotate(${finalDisplayAngle}deg)`;
            }
            // keep probe at anchor (image-relative)
            if (activeItem.anchor) setProbePositionFromImagePercent(activeItem.anchor.x, activeItem.anchor.y);

            const frame = Math.floor(r * 199) + 1;
            if (frame !== currentFrame) update(frame);
            updateBeam();
            // small debounce to avoid immediate overwrite from pointermove
            setTimeout(() => { isAdjustingTiltSlider = false; }, 120);
        });

        tiltWrap.appendChild(label);
        tiltWrap.appendChild(slider);
        scanControls.appendChild(tiltWrap);
        tiltSlider = slider;
    }

    const targetTitles = ['腹部：右側腹部', '腹部：左側腹部'];
    if (targetTitles.includes(item.title)) {
        const breathBtn = document.createElement('button');
        breathBtn.className = 'toggle-btn';
        breathBtn.innerText = '息を吸う (BREATH IN)';

        breathBtn.onclick = () => {
            if (currentFrame !== 1) {
                alert('プローブを開始位置（一番上）に合わせてから「息を吸う」を押してください。');
                return;
            }

            const video = document.getElementById('inhale-video');
            breathBtn.disabled = true;
            breathBtn.style.opacity = '0.5';

            const videoPath = `${item.folder}_inhale.mp4`;
            video.src = videoPath;
            video.style.display = 'block';
            video.style.zIndex = '9999';

            video.load();
            video.play().catch(e => {
                console.error('Play error:', e);
                video.onended();
            });

            video.onended = () => {
                video.style.display = 'none';
                video.pause();
                video.src = '';
                breathBtn.disabled = false;
                breathBtn.style.opacity = '1';
                draw(currentFrame);
                updateBeam();
            };
        };
        btnGroup.appendChild(breathBtn);
    }

    update(currentFrame);
    updateBeam();
}

function loadImages(folder) {
    currentFolder = folder;
    const viewer = document.getElementById('viewer');
    viewer.innerHTML = '';

    const img = document.createElement('img');
    img.id = 'current-frame';
    img.classList.add('active');
    img.style.width = '100%';
    img.style.height = 'auto';
    img.src = `${folder}/frame_${String(1).padStart(3, '0')}.jpg`;
    img.onload = () => {
        const canvas = document.getElementById('drawingCanvas');
        canvas.width = img.clientWidth;
        canvas.height = img.clientHeight;
        update(1);
    };
    viewer.appendChild(img);
}

function setFrameImage(frame) {
    const img = document.getElementById('current-frame');
    if (!img || !currentFolder) return;
    const nextSrc = `${currentFolder}/frame_${String(frame).padStart(3, '0')}.jpg`;
    if (img.getAttribute('src') === nextSrc) return;
    const targetFrame = frame;
    img.onload = () => {
        if (currentFrame !== targetFrame) return;
        draw(targetFrame);
        updateBeam();
    };
    img.src = nextSrc;
}

function draw(f) {
    const canvas = document.getElementById('drawingCanvas');
    const ctx = canvas.getContext('2d');
    const activeImg = document.querySelector('#viewer img.active');
    if (!activeImg || activeImg.clientWidth === 0) return;

    const rect = activeImg.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.position = 'absolute';
    canvas.style.left = activeImg.offsetLeft + 'px';
    canvas.style.top = activeImg.offsetTop + 'px';
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!activeItem || !activeData || !activeData[activeItem.title]) return;
    const caseData = activeData[activeItem.title];

    for (const sName in visibleStructures) {
        if (!visibleStructures[sName]) continue;
        const sData = caseData[sName];
        if (!sData || !sData.points || sData.points.length === 0) continue;

        const pointsData = sData.points;
        const firstFrame = pointsData[0].frame;
        const lastFrame = pointsData[pointsData.length - 1].frame;
        if (f < firstFrame || f > lastFrame) continue;

        let s = pointsData[0];
        let e = pointsData[pointsData.length - 1];
        for (let i = 0; i < pointsData.length - 1; i++) {
            if (f >= pointsData[i].frame && f <= pointsData[i + 1].frame) {
                s = pointsData[i];
                e = pointsData[i + 1];
                break;
            }
        }

        const r = (f - s.frame) / (e.frame - s.frame || 1);
        const sSegments = s.segments || [{ p: s.p, color: sData.color, border: sData.border }];
        const eSegments = e.segments || [{ p: e.p, color: sData.color, border: sData.border }];
        const segmentCount = Math.max(sSegments.length, eSegments.length);

        for (let si = 0; si < segmentCount; si++) {
            const sseg = sSegments[si] || sSegments[0];
            const eseg = eSegments[si] || eSegments[0];
            if (!sseg || !eseg || !sseg.p || !eseg.p) continue;

            ctx.beginPath();
            ctx.fillStyle = normalizeFillColor(sseg.color || sData.color, sseg.border || sData.border);
            ctx.strokeStyle = sseg.border || sData.border;
            ctx.lineWidth = 2;

            sseg.p.forEach((p, i) => {
                const targetP = eseg.p[i] || p;
                const px = (p.x + (targetP.x - p.x) * r) * canvas.width;
                const py = (p.y + (targetP.y - p.y) * r) * canvas.height;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            });

            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
    }
}

function update(f) {
    setFrameImage(f);
    const active = document.querySelector('#viewer img.active');
    if (active) active.classList.add('active');

    currentFrame = parseInt(f, 10);
    document.getElementById('frame-num').innerText = f;
    const slider = document.getElementById('frame-slider');
    if (slider) slider.value = f;
    const frameInput = document.getElementById('frame-input');
    if (frameInput) frameInput.value = f;

    if (activeItem) {
        const itemData = activeData?.[activeItem.title] || {};
        const btns = document.querySelectorAll('.toggle-btn');
        btns.forEach(btn => {
            if (btn.innerText.includes('息を吸う')) {
                if (currentFrame === 1) {
                    btn.style.opacity = '1';
                    btn.style.pointerEvents = 'auto';
                    btn.style.border = '2px solid var(--accent-green)';
                    btn.style.boxShadow = '0 0 10px var(--accent-green)';
                } else {
                    btn.style.opacity = '0.3';
                    btn.style.pointerEvents = 'none';
                    btn.style.border = '1px solid #444';
                    btn.style.boxShadow = 'none';
                }
                return;
            }

            const sName = btn.dataset.structure;
            const sData = itemData[sName];
            const range = getAnnotationFrameRange(sData);
            btn.style.display = range && currentFrame >= range[0] && currentFrame <= range[1] ? 'block' : 'none';
        });
    }

    const breathBtn = Array.from(document.querySelectorAll('.toggle-btn')).find(btn => btn.innerText.includes('息を吸う'));
    if (breathBtn) {
        if (currentFrame === 1) {
            breathBtn.style.opacity = '1';
            breathBtn.style.border = '2px solid var(--accent-green)';
        } else {
            breathBtn.style.opacity = '0.3';
            breathBtn.style.border = '1px solid #444';
        }
    }

    draw(currentFrame);
}

let suppressClick = false;

probe.addEventListener('pointerdown', (e) => {
    if (!activeItem) return;
    isHoldingProbe = true;
    suppressClick = true;
    probe.classList.add('holding');
    probe.setPointerCapture(e.pointerId);
    queueProbeMove(e);
    e.preventDefault();
    e.stopPropagation();
});

probe.addEventListener('pointerup', (e) => {
    if (isHoldingProbe) {
        isHoldingProbe = false;
        probe.classList.remove('holding');
    }
    suppressClick = false;
});

probe.addEventListener('pointercancel', () => {
    if (isHoldingProbe) {
        isHoldingProbe = false;
        probe.classList.remove('holding');
    }
    suppressClick = false;
});

function backToMenu() {
    document.getElementById('echo-detail').style.display = 'none';
    // remove tilt control if present
    const existingTilt = document.getElementById('tilt-control');
    if (existingTilt) existingTilt.remove();
    if (activeItem && activeItem.folder.includes('abs')) {
        document.getElementById('abdomen-nav').style.display = 'flex';
    } else {
        document.getElementById('main-menu').style.display = 'block';
    }
}

window.addEventListener('resize', () => draw(currentFrame));

function openAbdomenNav() {
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('abdomen-nav').style.display = 'flex';
}

function backToMainMenuFromAbdomen() {
    document.getElementById('abdomen-nav').style.display = 'none';
    document.getElementById('main-menu').style.display = 'block';
}

function showTerms() {
    const modal = document.getElementById('terms-modal');
    if (modal) modal.style.display = 'flex';
}

function closeTerms() {
    const modal = document.getElementById('terms-modal');
    if (modal) modal.style.display = 'none';
}

function openFeedback() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;
    modal.style.display = 'flex';
}

function closeFeedback() {
    const modal = document.getElementById('feedback-modal');
    if (!modal) return;
    modal.style.display = 'none';
}

function submitFeedback() {
    const textarea = document.getElementById('feedback-text');
    if (!textarea) return;

    const text = textarea.value.trim();
    if (!text) {
        alert('フィードバック内容を入力してください。');
        return;
    }

    const feedbacks = JSON.parse(localStorage.getItem('appFeedbacks') || '[]');
    feedbacks.push({
        text,
        date: new Date().toISOString(),
        page: activeItem ? activeItem.title : 'main-menu'
    });
    localStorage.setItem('appFeedbacks', JSON.stringify(feedbacks));

    textarea.value = '';
    closeFeedback();
    alert('ご意見を送信しました。ありがとうございます。');
}

function initProbe() {
    if (!probe || !activeItem) return;
    isHoldingProbe = false;
    probe.classList.remove('holding');

    if (activeItem.type === 'tilt') {
        setProbePositionFromImagePercent(activeItem.anchor.x, activeItem.anchor.y);
        if (activeItem.axis === 'z') {
            probe.style.transform = `translate(-50%, 0%) rotate(${activeItem.baseRotate}deg) rotateX(0deg)`;
        } else {
            probe.style.transform = `translate(-50%, 0%) rotate(${activeItem.baseRotate}deg)`;
        }
    } else if (activeItem.start) {
        setProbePositionFromImagePercent(activeItem.start.x, activeItem.start.y);
        probe.style.transform = `translate(-50%, -50%) rotate(${activeItem.rotate || 0}deg)`;
    }

    // If tilt slider exists, initialize its value to match probe position
    if (activeItem.type === 'tilt' && tiltSlider) {
        // default to middle of range
        let initialR = 0;
        if (activeItem.axis === 'z') {
            // tiltX = 60 - r * 120 => r = (60 - tiltX)/120. Start at 50%
            initialR = 0.5;
        } else {
            const s = activeItem.startAngle || 0;
            const e = activeItem.endAngle || 0;
            initialR = ( (s + e) / 2 - s ) / (e - s || 1);
        }
        tiltSlider.value = Math.round(initialR * 100);
    }

    updateBeam();
}

function queueProbeMove(e) {
    if (!isHoldingProbe || !activeItem) return;
    if (e.cancelable) e.preventDefault();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    lastProbeMovePosition = { clientX, clientY };
    if (probeMoveAnimationFrame === null) {
        probeMoveAnimationFrame = requestAnimationFrame(() => {
            probeMoveAnimationFrame = null;
            applyProbeMove();
        });
    }
}

function applyProbeMove() {
    if (!isHoldingProbe || !activeItem || !lastProbeMovePosition) return;
    const { clientX, clientY } = lastProbeMovePosition;
    const rect = vContainer.getBoundingClientRect();
    const activeImg = document.querySelector('#viewer img.active');
    let curX, curY;
    if (activeImg && activeImg.clientWidth > 0) {
        const imgRect = activeImg.getBoundingClientRect();
        curX = ((clientX - imgRect.left) / imgRect.width) * 100;
        curY = ((clientY - imgRect.top) / imgRect.height) * 100;
    } else {
        curX = ((clientX - rect.left) / rect.width) * 100;
        curY = ((clientY - rect.top) / rect.height) * 100;
    }

    let r = 0;
    let currentTransform = '';

    if (activeItem.type === 'tilt') {
        if (activeItem.axis === 'z') {
            const dy = curY - activeItem.anchor.y;
            const sensitivity = 40;
            r = (dy + sensitivity / 2) / sensitivity;
            r = Math.max(0, Math.min(1, r));
            const tiltX = 60 - r * 120;
            currentTransform = `translate(-50%, 0%) rotate(${activeItem.baseRotate}deg) rotateX(${tiltX}deg)`;
            probe.style.filter = `brightness(${1.1 - r * 0.4})`;
        } else {
            const start = activeItem.startAngle || 0;
            const end = activeItem.endAngle || 0;
            const angleRange = end - start;
            
            // Simple approach: map finger position relative to anchor into 0-1 range
            const dx = curX - activeItem.anchor.x;
            const dy = curY - activeItem.anchor.y;
            
            // Use distance and direction from anchor to estimate r
            // Finger movement of ~90 pixels represents full frame range
            const distance = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx) * (180 / Math.PI);
            const referenceDistance = 90; // pixels
            let rawR = distance / referenceDistance;
            
            // Map angle to direction (0-1)
            // For simplicity, use vertical movement: up increases r, down decreases r
            const normalizedDy = dy / 50; // 50px = full range
            r = normalizedDy;
            r = Math.max(0, Math.min(1, r));

            // Calculate target angle as simple linear interpolation
            const targetAngle = start + r * angleRange;
            const finalDisplayAngle = (activeItem.baseRotate - 90) + targetAngle;
            currentTransform = `translate(-50%, 0%) rotate(${finalDisplayAngle}deg)`;
        }
        setProbePositionFromImagePercent(activeItem.anchor.x, activeItem.anchor.y);
    } else {
        const S = activeItem.start;
        const E = activeItem.end;
        if (S && E) {
            const vSE = { x: E.x - S.x, y: E.y - S.y };
            const vSP = { x: curX - S.x, y: curY - S.y };
            const magSq = vSE.x * vSE.x + vSE.y * vSE.y;
            r = magSq === 0 ? 0 : (vSP.x * vSE.x + vSP.y * vSE.y) / magSq;
            r = Math.max(0, Math.min(1, r));
            const xpos = S.x + vSE.x * r;
            const ypos = S.y + vSE.y * r;
            setProbePositionFromImagePercent(xpos, ypos);
            currentTransform = `translate(-50%, -50%) rotate(${activeItem.rotate || 0}deg)`;
        }
    }

    probe.style.transform = currentTransform;
    
    // Apply perspective effect for left flank only: scale and opacity based on frame position
    if (activeItem && activeItem.folder === 'abs_left_flank') {
        const scale = 0.6 + r * 0.7; // 0.6 (frame 1, far) to 1.3 (frame 200, near)
        const opacity = 0.5 + r * 0.5; // 0.5 (frame 1) to 1.0 (frame 200)
        probe.style.transform = currentTransform + ` scale(${scale})`;
        probe.style.opacity = opacity;
    } else {
        probe.style.opacity = 1;
    }
    
    const frame = Math.floor(r * 199) + 1;
    if (frame !== currentFrame) update(frame);
    updateBeam();
        // update tilt slider position when probe is moved by dragging
        if (tiltSlider && activeItem && activeItem.type === 'tilt' && !isAdjustingTiltSlider) {
            tiltSlider.value = Math.round(r * 100);
        }
}

function updateBeam() {
    if (!vContainer || !beamCanvas || !probe || !activeItem) return;
    const rect = vContainer.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (beamCanvas.width !== width || beamCanvas.height !== height) {
        beamCanvas.width = width;
        beamCanvas.height = height;
    }
    beamCtx.clearRect(0, 0, width, height);

    const probeRect = probe.getBoundingClientRect();
    const containerRect = rect;
    let currentRotation = 0;
    if (activeItem.type === 'tilt') {
        const style = window.getComputedStyle(probe);
        const matrix = new DOMMatrix(style.transform);
        currentRotation = Math.atan2(matrix.b, matrix.a) * (180 / Math.PI);
    } else {
        currentRotation = activeItem.rotate || 0;
    }
    const angleRad = currentRotation * (Math.PI / 180);
    const isAbdomen = activeItem.category === 'ABDOMEN' || activeItem.title.includes('腹部');
    const localDirection = isAbdomen ? -Math.PI / 2 : Math.PI / 2;
    const directionRad = angleRad + localDirection;

    const absRot = Math.abs(currentRotation % 360);
    let lineWidth;
    let distToTip;
    if ((absRot > 45 && absRot < 135) || (absRot > 225 && absRot < 315)) {
        lineWidth = probeRect.height * 0.8;
        distToTip = probeRect.width / 2;
    } else {
        lineWidth = probeRect.width * 0.8;
        distToTip = probeRect.height / 2;
    }

    if (activeItem.showGuide && activeItem.start && activeItem.end) {
        const sCenterX = (activeItem.start.x / 100) * rect.width;
        const sCenterY = (activeItem.start.y / 100) * rect.height;
        const correctedStartX = sCenterX + Math.cos(directionRad) * distToTip;
        const correctedStartY = sCenterY + Math.sin(directionRad) * distToTip;
        const eCenterX = (activeItem.end.x / 100) * rect.width;
        const eCenterY = (activeItem.end.y / 100) * rect.height;
        const correctedEndX = eCenterX + Math.cos(directionRad) * distToTip;
        const correctedEndY = eCenterY + Math.sin(directionRad) * distToTip;

        beamCtx.beginPath();
        beamCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        beamCtx.setLineDash([5, 5]);
        beamCtx.lineWidth = 2;
        beamCtx.moveTo(correctedStartX, correctedStartY);
        beamCtx.lineTo(correctedEndX, correctedEndY);
        beamCtx.stroke();
        beamCtx.setLineDash([]);
    }

    const centerX = (probeRect.left + probeRect.width / 2) - containerRect.left;
    const centerY = (probeRect.top + probeRect.height / 2) - containerRect.top;
    const lineOffset = activeItem.lineRotate || 0;
    const bottomCenterX = centerX + Math.cos(directionRad) * (distToTip + 1);
    const bottomCenterY = centerY + Math.sin(directionRad) * (distToTip + 1);
    const finalLineAngle = angleRad + (lineOffset * Math.PI / 180);

    const p1 = {
        x: bottomCenterX + Math.cos(finalLineAngle) * (lineWidth / 2),
        y: bottomCenterY + Math.sin(finalLineAngle) * (lineWidth / 2)
    };
    const p2 = {
        x: bottomCenterX - Math.cos(finalLineAngle) * (lineWidth / 2),
        y: bottomCenterY - Math.sin(finalLineAngle) * (lineWidth / 2)
    };

    beamCtx.beginPath();
    beamCtx.strokeStyle = 'rgba(0, 210, 255, 0.9)';
    beamCtx.lineWidth = 4;
    beamCtx.lineCap = 'round';
    beamCtx.moveTo(p1.x, p1.y);
    beamCtx.lineTo(p2.x, p2.y);
    beamCtx.stroke();
    beamCtx.shadowBlur = 15;
    beamCtx.shadowColor = 'rgba(0, 210, 255, 0.8)';
    beamCtx.stroke();
    beamCtx.shadowBlur = 0;
}

probe.onclick = (e) => {
    if (!activeItem) return;
    // クリックでのトグルは無効化し、ドラッグのみ有効にする
    e.stopPropagation();
    e.preventDefault();
};

window.addEventListener('pointermove', queueProbeMove);
window.addEventListener('touchmove', queueProbeMove, { passive: false });
window.addEventListener('pointerup', () => {
    if (isHoldingProbe) {
        isHoldingProbe = false;
        probe.classList.remove('holding');
    }
    suppressClick = false;
});
window.addEventListener('resize', updateBeam);

window.menuConfig = menuConfig;
window.openScanner = openScanner;
window.backToMainMenuFromAbdomen = backToMainMenuFromAbdomen;
window.backToMenu = backToMenu;
window.showTerms = showTerms;
window.closeTerms = closeTerms;
window.openFeedback = openFeedback;
window.closeFeedback = closeFeedback;
window.submitFeedback = submitFeedback;

function clampFrameValue(value) {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return 1;
    return Math.max(1, Math.min(200, parsed));
}

function setupFrameJumpControls() {
    const slider = document.getElementById('frame-slider');
    const frameInput = document.getElementById('frame-input');
    const frameJump = document.getElementById('frame-jump');
    if (!slider || !frameInput || !frameJump) return;

    slider.addEventListener('input', (event) => {
        const value = clampFrameValue(event.target.value);
        update(value);
    });

    frameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const value = clampFrameValue(frameInput.value);
            update(value);
        }
    });

    frameInput.addEventListener('blur', () => {
        const value = clampFrameValue(frameInput.value);
        if (value !== currentFrame) update(value);
    });

    frameJump.addEventListener('click', () => {
        const value = clampFrameValue(frameInput.value);
        update(value);
    });
}

initMenu();

// 腹部ナビゲーションのボタンにツールチップを追加
menuConfig[0].items.forEach((item, idx) => {
    const btn = document.querySelector(`[onclick="openScanner(menuConfig[0].items[${idx}])"]`);
    if (btn) {
        btn.title = `主な構造物：
${item.structures.join('、')}`;
    }
});

setTimeout(() => {
    initProbe();
    setupFrameJumpControls();
}, 100);
