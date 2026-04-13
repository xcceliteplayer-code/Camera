/* ══════════════════════════════════════
   WCAM PRO V2 — body-tracker.js
   Upper/half-body detection + pose classification
   No external library — pure pixel analysis
══════════════════════════════════════ */
'use strict';

const BodyTracker = (() => {

  // Stores last known body region
  let lastBody = null;

  /**
   * Given a detected face, infer upper body bounding box.
   * Human body proportions: head ≈ 1/7.5 of total height.
   * For half-body we use ~3× face height below neck.
   */
  const inferBodyFromFace = (face, W, H) => {
    const { x, y, w, h } = face;

    // Neck starts roughly at bottom of face box
    const neckY  = y + h * 1.05;

    // Shoulder width ≈ 2.5× face width, centered on face
    const shoulderW = w * 2.5;
    const bodyX     = U.clamp(x + w/2 - shoulderW/2, 0, W - 1);

    // Half-body height = ~3× face height below neck
    const bodyH = h * 3.2;
    const bodyY = U.clamp(neckY, 0, H - 1);
    const bodyW = U.clamp(shoulderW, 10, W - bodyX);
    const cappedH = Math.min(bodyH, H - bodyY);

    return {
      x: Math.round(bodyX),
      y: Math.round(bodyY),
      w: Math.round(bodyW),
      h: Math.round(cappedH),
      // Key joints (estimated from proportions)
      joints: {
        neck:      [x + w/2,          neckY],
        lShoulder: [bodyX + bodyW*0.15, neckY + h*0.35],
        rShoulder: [bodyX + bodyW*0.85, neckY + h*0.35],
        lElbow:    [bodyX + bodyW*0.04, neckY + h*1.15],
        rElbow:    [bodyX + bodyW*0.96, neckY + h*1.15],
        lWrist:    [bodyX + bodyW*0.00, neckY + h*1.95],
        rWrist:    [bodyX + bodyW*1.00, neckY + h*1.95],
        sternum:   [x + w/2,           neckY + h*0.7],
        lHip:      [bodyX + bodyW*0.28, neckY + h*2.2],
        rHip:      [bodyX + bodyW*0.72, neckY + h*2.2],
      }
    };
  };

  /**
   * Classify pose from face position + body region
   * @param {object} face
   * @param {number} W frame width
   * @param {number} H frame height
   */
  const classifyPose = (face, W, H) => {
    if (!face) return { pose: 'Tidak terdeteksi', headDir: '—', confidence: 0 };

    const fx = face.x + face.w / 2;  // face center X
    const fy = face.y + face.h / 2;  // face center Y
    const normX = fx / W;             // 0=left, 1=right
    const normY = fy / H;             // 0=top, 1=bottom

    // Head orientation from face aspect + position
    let headDir = 'Lurus';
    if (normX < 0.35)      headDir = 'Kanan (mirror)';
    else if (normX > 0.65) headDir = 'Kiri (mirror)';

    // Face aspect ratio hints at tilt
    const faceAR = face.w / face.h;
    if (faceAR > 1.2)      headDir += ' ↔ Miring';

    // Pose classification by vertical position + size relative to frame
    const faceAreaRatio = (face.w * face.h) / (W * H);
    let pose = 'Berdiri';

    if (faceAreaRatio > 0.09)   pose = 'Sangat Dekat';
    else if (faceAreaRatio > 0.05) pose = 'Dekat Kamera';
    else if (normY > 0.55)       pose = 'Condong Maju';
    else if (normY < 0.3)        pose = 'Berdiri Tegak';
    else                          pose = 'Posisi Normal';

    const confidence = Math.min(100, Math.round(faceAreaRatio * 1200));

    return { pose, headDir, confidence };
  };

  /**
   * Detect hand/arm motion regions using skin + position relative to body
   * Returns descriptive string about hand movement
   */
  const detectHandActivity = (d, W, H, face) => {
    if (!face) return '—';

    const SCALE = 12;
    const sw = Math.floor(W / SCALE), sh = Math.floor(H / SCALE);

    // Face region in scaled coords
    const fxMin = Math.floor(face.x / SCALE);
    const fxMax = Math.ceil((face.x + face.w) / SCALE);
    const fyMin = Math.floor(face.y / SCALE);
    const fyMax = Math.ceil((face.y + face.h) / SCALE);

    // Look for skin pixels BELOW face and OUTSIDE face horizontally
    let leftHand=0, rightHand=0, total=0;
    const bodyTopY = fyMax; // start below face

    for(let y = bodyTopY; y < sh; y++) {
      for(let x = 0; x < sw; x++) {
        const ox=x*SCALE, oy=y*SCALE;
        if(ox>=W||oy>=H) continue;
        const idx=(oy*W+ox)*4;
        const r=d[idx],g=d[idx+1],b=d[idx+2];
        const isSkin=(r>90&&g>40&&b>20&&(Math.max(r,g,b)-Math.min(r,g,b))>15&&r>g&&r>b);
        if(isSkin) {
          total++;
          if(x < fxMin) leftHand++;
          else if(x > fxMax) rightHand++;
        }
      }
    }

    if(total < 5) return 'Tidak terlihat';
    const hasLeft  = leftHand  > 8;
    const hasRight = rightHand > 8;
    if(hasLeft && hasRight) return 'Kedua tangan aktif';
    if(hasLeft)  return 'Tangan kiri terlihat';
    if(hasRight) return 'Tangan kanan terlihat';
    return 'Tangan di dekat tubuh';
  };

  const update = (d, W, H, faces) => {
    const face = faces.length > 0 ? faces[0] : null;
    const body = face ? inferBodyFromFace(face, W, H) : null;
    if (body) lastBody = body;

    const poseInfo    = classifyPose(face, W, H);
    const handInfo    = detectHandActivity(d, W, H, face);
    const bodyVisible = !!body;

    return { body, face, poseInfo, handInfo, bodyVisible };
  };

  const getLastBody = () => lastBody;

  return { update, inferBodyFromFace, classifyPose, detectHandActivity, getLastBody };
})();
