export function drawNotebookPage(canvas, pg, current = null) {
  const c = canvas.getContext("2d");
  if (!c || !pg) return;
  c.save();
  c.scale(canvas.width / 1200, canvas.height / 900);
  c.fillStyle = "white";
  c.fillRect(0, 0, 1200, 900);
  if (pg.background !== "무지") {
    c.strokeStyle = "#dce4ee";
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= 1200; x += 30) {
      c.moveTo(x, 0);
      c.lineTo(x, 900);
    }
    for (let y = 0; y <= 900; y += 30) {
      c.moveTo(0, y);
      c.lineTo(1200, y);
    }
    c.stroke();
    if (pg.background === "좌표평면") {
      c.strokeStyle = "#8894a6";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(600, 0);
      c.lineTo(600, 900);
      c.moveTo(0, 450);
      c.lineTo(1200, 450);
      c.stroke();
    }
  }
  const layer = document.createElement("canvas");
  layer.width = canvas.width;
  layer.height = canvas.height;
  const pen = layer.getContext("2d");
  pen.scale(layer.width / 1200, layer.height / 900);
  pen.lineCap = "round";
  const strokes = Array.isArray(pg.strokes) ? pg.strokes : [];
  for (const s of current ? [...strokes, current] : strokes) {
    if (
      !s ||
      !Array.isArray(s.points) ||
      !Number.isFinite(s.width) ||
      s.width <= 0
    )
      continue;
    pen.globalCompositeOperation =
      s.tool === "erase" ? "destination-out" : "source-over";
    pen.strokeStyle = pen.fillStyle = s.color;
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i],
        prev = s.points[Math.max(0, i - 1)];
      if (![p?.x, p?.y, prev?.x, prev?.y].every(Number.isFinite)) continue;
      pen.lineWidth =
        Math.min(100, s.width) *
        (0.5 +
          (Number.isFinite(p.pressure)
            ? Math.max(0, Math.min(1, p.pressure || 0.5))
            : 0.5));
      pen.beginPath();
      if (!i) {
        pen.arc(p.x, p.y, pen.lineWidth / 2, 0, 2 * Math.PI);
        pen.fill();
      } else {
        pen.moveTo(prev.x, prev.y);
        pen.lineTo(p.x, p.y);
        pen.stroke();
      }
    }
  }
  c.drawImage(layer, 0, 0, 1200, 900);
  c.restore();
}
