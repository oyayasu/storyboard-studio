(() => {
  const templates = [
    {
      id: "sheet-4x4",
      label: "Storyboard Sheet 4×4",
      cols: 4,
      rows: 4,
      width: 1650,
      height: 1275,
      boxes: [
        [13, 64, 385, 218],
        [423, 64, 385, 218],
        [830, 64, 384, 218],
        [1242, 64, 385, 218],
        [13, 355, 385, 218],
        [423, 355, 385, 218],
        [830, 355, 384, 218],
        [1242, 355, 385, 218],
        [14, 653, 384, 218],
        [423, 653, 385, 218],
        [830, 653, 385, 218],
        [1242, 653, 385, 218],
        [15, 949, 384, 218],
        [424, 949, 385, 218],
        [831, 949, 385, 218],
        [1243, 949, 385, 218],
      ],
    },
    {
      id: "sheet-3x5",
      label: "Storyboard Sheet 3×5",
      cols: 3,
      rows: 5,
      width: 1658,
      height: 2048,
      boxes: [
        [48, 222, 500, 282],
        [583, 222, 500, 282],
        [1120, 222, 500, 282],
        [48, 586, 501, 282],
        [583, 586, 500, 282],
        [1119, 586, 501, 282],
        [48, 942, 500, 281],
        [583, 942, 500, 281],
        [1119, 942, 501, 281],
        [48, 1298, 500, 281],
        [583, 1298, 500, 281],
        [1119, 1298, 501, 281],
        [48, 1653, 501, 282],
        [583, 1653, 500, 282],
        [1119, 1653, 501, 282],
      ],
    },
  ];

  let customTemplates=[];
  const allTemplates=()=>[...templates,...customTemplates];
  function setCustomTemplates(list){customTemplates=Array.isArray(list)?list.filter(t=>t?.custom&&typeof t.id==='string'&&Array.isArray(t.boxes)&&t.boxes.length&&Number.isFinite(t.width)&&Number.isFinite(t.height)).slice(0,40):[];}
  const uid = (prefix = "id") =>
    `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}-${Date.now()}`;

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function exactDimensionTemplate(img) {
    return (
      allTemplates().find(
        (t) =>
          Math.abs(img.width - t.width) <= 3 &&
          Math.abs(img.height - t.height) <= 3,
      ) || null
    );
  }

  function makeAnalysisCanvas(img, maxWidth = 900) {
    const scale = Math.min(1, maxWidth / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { canvas, ctx, scale };
  }

  function luminanceAt(data, width, height, x, y) {
    x = Math.max(0, Math.min(width - 1, Math.round(x)));
    y = Math.max(0, Math.min(height - 1, Math.round(y)));
    const i = (y * width + x) * 4;
    const alpha = data[i + 3] / 255;
    return (
      (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) * alpha +
      255 * (1 - alpha)
    );
  }

  function borderConfidence(img, template) {
    const ratioErr = Math.abs(
      img.width / img.height - template.width / template.height,
    );
    if (ratioErr > 0.025) return 0;
    const { canvas, ctx } = makeAnalysisCanvas(img, 1200),
      sx = canvas.width / template.width,
      sy = canvas.height / template.height;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const lum = (x, y) => luminanceAt(data, canvas.width, canvas.height, x, y);
    let strongSides = 0,
      strongPanels = 0;
    for (const [x, y, w, h] of template.boxes) {
      const sides = [
        [[x, y], [x + w, y], [0, -1], sy],
        [[x, y + h], [x + w, y + h], [0, 1], sy],
        [[x, y], [x, y + h], [-1, 0], sx],
        [[x + w, y], [x + w, y + h], [1, 0], sx],
      ];
      let panelSides = 0;
      for (const [start, end, normal, scale] of sides) {
        let best = 0;
        // A straight edge must remain in the same position across the side.
        // Darkness alone is not evidence of a storyboard frame.
        for (let offset = -4; offset <= 4; offset += 0.5) {
          let found = 0;
          for (let i = 1; i < 18; i++) {
            const x =
              (start[0] + ((end[0] - start[0]) * i) / 18) * sx +
              normal[0] * offset * scale;
            const y =
              (start[1] + ((end[1] - start[1]) * i) / 18) * sy +
              normal[1] * offset * scale;
            const edge = Math.min(
              lum(x, y),
              lum(x + normal[0] * 0.5, y + normal[1] * 0.5),
              lum(x - normal[0] * 0.5, y - normal[1] * 0.5),
            );
            const outside = lum(
              x + normal[0] * 5 * scale,
              y + normal[1] * 5 * scale,
            );
            if (outside >= 165 && edge <= 215 && outside - edge >= 35) found++;
          }
          best = Math.max(best, found / 17);
        }
        if (best >= 0.76) {
          strongSides++;
          panelSides++;
        }
      }
      if (panelSides >= 3) strongPanels++;
    }
    return Math.min(
      strongSides / (template.boxes.length * 4),
      strongPanels / template.boxes.length,
    );
  }

  function detectTemplate(img) {
    const exact = exactDimensionTemplate(img);
    let best = null;
    for (const template of allTemplates()) {
      if (
        Math.abs(img.width / img.height - template.width / template.height) >
        0.025
      )
        continue;
      const confidence = borderConfidence(img, template);
      if(confidence < (template.custom ? .9 : .75))continue;
      if (!best || confidence > best.confidence)
        best = {
          template,
          confidence,
          reason: template === exact ? "size-and-frame-layout" : "frame-layout",
        };
    }
    return best && best.confidence >= (best.template.custom?0.9:0.75) ? best : null;
  }

  function cropCanvas(img, template, box, inset = template.cropInset ?? 7) {
    const sx = img.width / template.width;
    const sy = img.height / template.height;
    const [x, y, w, h] = box;
    const cx = Math.round((x + inset) * sx);
    const cy = Math.round((y + inset) * sy);
    const cw = Math.max(1, Math.round((w - inset * 2) * sx));
    const ch = Math.max(1, Math.round((h - inset * 2) * sy));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext("2d").drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
    return canvas;
  }

  function isBlank(canvas) {
    const sampleW = Math.min(260, canvas.width);
    const sampleH = Math.max(
      1,
      Math.round((canvas.height * sampleW) / canvas.width),
    );
    const small = document.createElement("canvas");
    small.width = sampleW;
    small.height = sampleH;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(canvas, 0, 0, sampleW, sampleH);
    const data = sctx.getImageData(0, 0, sampleW, sampleH).data;

    const margin = 5;
    const points = [
      [margin, margin],
      [sampleW - margin - 1, margin],
      [margin, sampleH - margin - 1],
      [sampleW - margin - 1, sampleH - margin - 1],
      [sampleW / 2, margin],
      [sampleW / 2, sampleH - margin - 1],
    ];
    const bgSamples = points.map(([x, y]) => {
      const i = (Math.round(y) * sampleW + Math.round(x)) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    });
    const bg = [0, 1, 2].map((k) =>
      Math.round(
        bgSamples.reduce((sum, c) => sum + c[k], 0) / bgSamples.length,
      ),
    );

    let changed = 0;
    const total = sampleW * sampleH;
    for (let i = 0; i < data.length; i += 4) {
      const d =
        Math.abs(data[i] - bg[0]) +
        Math.abs(data[i + 1] - bg[1]) +
        Math.abs(data[i + 2] - bg[2]);
      if (d > 28) changed++;
    }
    return changed / total < 0.0015;
  }

  function ratioSize(ratio) {
    if (ratio === "9:16") return [540, 960];
    if (ratio === "4:3" || ratio === "3:4") return [960, 720];
    return [960, 540];
  }

  function fitToProject(img, ratio) {
    // Preserve the image's actual aspect ratio. The viewer/exporter draws configurable
    // letterbox padding, rather than baking black bars permanently into the asset.
    const [maxW, maxH] = ratioSize(ratio);
    const scale = Math.min(
      1,
      Math.max(maxW, maxH) / Math.max(img.width, img.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function saveCanvasAsset(canvas, sourceName, meta = {}) {
    const id = uid("asset");
    const dataUrl = canvas.toDataURL("image/png");
    const asset = { id, dataUrl, sourceName, createdAt: Date.now(), ...meta };
    await SSDB.putAsset(asset);
    return asset;
  }

  async function importAsTemplate(img, fileName, ratio, template) {
    const panels = [];
    for (let i = 0; i < template.boxes.length; i++) {
      const crop = cropCanvas(img, template, template.boxes[i], template.cropInset ?? 7);
      if (isBlank(crop)) continue;
      const cropImage = await loadImage(crop.toDataURL("image/png"));
      const fitted = fitToProject(cropImage, ratio);
      const asset = await saveCanvasAsset(fitted, fileName, {
        template: template.id,
        panelIndex: i + 1,
      });
      panels.push({ assetId: asset.id, asset, panelIndex: i + 1 });
    }
    return panels;
  }

  async function importImageFile(file, ratio, options = {}) {
    const src = await fileToDataURL(file);
    const img = await loadImage(src);
    let detection = null;

    if (options.forceTemplateId) {
      const t = allTemplates().find((x) => x.id === options.forceTemplateId);
      if (t) detection = { template: t, confidence: 1, reason: "forced" };
    } else if (!options.forceSingleImage) {
      detection = detectTemplate(img);
    }

    if (detection?.template) {
      const panels = await importAsTemplate(
        img,
        file.name,
        ratio,
        detection.template,
      );
      return {
        kind: "sheet",
        template: detection.template.id,
        templateLabel: detection.template.label,
        confidence: detection.confidence,
        reason: detection.reason,
        panels,
      };
    }

    const fitted = fitToProject(img, ratio);
    const asset = await saveCanvasAsset(fitted, file.name, {
      originalWidth: img.width,
      originalHeight: img.height,
    });
    return {
      kind: "image",
      assetId: asset.id,
      asset,
      originalWidth: img.width,
      originalHeight: img.height,
    };
  }

  window.SSImporter = {
    importImageFile,
    detectTemplate,
    get templates(){return allTemplates();},
    setCustomTemplates,
    uid,
    borderConfidence,
  };
})();
