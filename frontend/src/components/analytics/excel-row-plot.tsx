import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { ExcelDataColumn, ExcelDataRow } from "@/api/analytics-api";

type Point = { x: number; y: number; row: ExcelDataRow };

function numericValue(value: string | number | boolean | null | undefined, kind: ExcelDataColumn["kind"]): number | null {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (kind === "date") {
    const timestamp = Date.parse(String(value));
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let normalized = value.trim().replace(/[−–]/g, "-").replace(/[$€£¥₹%\s]/g, "").replace(/\((.+)\)/, "-$1");
  if (normalized.includes(",")) {
    if (normalized.includes(".")) normalized = normalized.replace(/,/g, "");
    else {
      const [whole, fractional = ""] = normalized.split(",").slice(-2);
      if (fractional.length > 0 && fractional.length <= 2 && whole !== undefined) {
        const prefix = normalized.slice(0, -(fractional.length + 1)).replace(/,/g, "");
        normalized = `${prefix}.${fractional}`;
      } else normalized = normalized.replace(/,/g, "");
    }
  }
  if (!/^-?(\d+(\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
  return String(value);
}

function shortLabel(value: string, max = 14): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function categoryJitter(rowNumber: number, span: number): number {
  // Stable jitter makes duplicate category values visible as separate row marks.
  const value = ((rowNumber * 2654435761) >>> 0) / 0xffffffff;
  return (value - 0.5) * span * 0.56;
}

function buildTooltip(row: ExcelDataRow): string {
  return Object.entries(row.values)
    .filter(([, value]) => value !== null && value !== "")
    .map(([name, value]) => `${name}: ${displayValue(value)}`)
    .join("\n");
}

export function countPlotRows(rows: ExcelDataRow[], columns: ExcelDataColumn[], xField: string, yField: string): number {
  const byName = new Map(columns.map((column) => [column.name, column]));
  const xColumn = byName.get(xField);
  const yColumn = byName.get(yField);
  if (!xColumn || !yColumn || xField === yField) return 0;
  return rows.filter((row) => {
    const x = row.values[xField];
    return xColumn.kind === "number" || xColumn.kind === "date"
      ? numericValue(x, xColumn.kind) !== null
      : x !== null && x !== undefined && x !== "";
  }).filter((row) => yColumn.kind === "number" || yColumn.kind === "date"
    ? numericValue(row.values[yField], yColumn.kind) !== null
    : row.values[yField] !== null && row.values[yField] !== undefined && row.values[yField] !== "").length;
}

export function ExcelRowPlot({
  rows,
  columns,
  xField,
  yField,
}: {
  rows: ExcelDataRow[];
  columns: ExcelDataColumn[];
  xField: string;
  yField: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const [size, setSize] = useState({ width: 900, height: 380 });
  const [hovered, setHovered] = useState<{ point: Point; left: number; top: number } | null>(null);
  const columnsByName = useMemo(() => new Map(columns.map((column) => [column.name, column])), [columns]);
  const xColumn = columnsByName.get(xField);
  const yColumn = columnsByName.get(yField);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !xColumn || !yColumn || xField === yField) return;
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(320, bounds.width);
    const height = Math.max(300, bounds.height);
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = "12px system-ui, sans-serif";
    context.fillStyle = "#667085";
    context.strokeStyle = "#e6e8ee";
    context.lineWidth = 1;

    const margin = { top: 22, right: 20, bottom: 64, left: 76 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xIsNumeric = xColumn.kind === "number" || xColumn.kind === "date";
    const yIsNumeric = yColumn.kind === "number" || yColumn.kind === "date";
    const xCategories = xIsNumeric ? [] : [...new Set(rows.map((row) => String(row.values[xField] ?? "")).filter(Boolean))];
    const yCategories = yIsNumeric ? [] : [...new Set(rows.map((row) => String(row.values[yField] ?? "")).filter(Boolean))];
    const categoryIndex = (value: string, categories: string[]) => categories.indexOf(value);
    const numericX = rows.map((row) => numericValue(row.values[xField], xColumn.kind)).filter((value): value is number => value !== null);
    const numericY = rows.map((row) => numericValue(row.values[yField], yColumn.kind)).filter((value): value is number => value !== null);
    const xMinRaw = numericX.length ? Math.min(...numericX) : 0;
    const xMaxRaw = numericX.length ? Math.max(...numericX) : 1;
    const yMinRaw = numericY.length ? Math.min(...numericY) : 0;
    const yMaxRaw = numericY.length ? Math.max(...numericY) : 1;
    const xPadding = xMinRaw === xMaxRaw ? Math.abs(xMinRaw || 1) * 0.05 : (xMaxRaw - xMinRaw) * 0.04;
    const yPadding = yMinRaw === yMaxRaw ? Math.abs(yMinRaw || 1) * 0.05 : (yMaxRaw - yMinRaw) * 0.04;
    const xMin = xMinRaw - xPadding;
    const xMax = xMaxRaw + xPadding;
    const yMin = yMinRaw - yPadding;
    const yMax = yMaxRaw + yPadding;
    const xCoordinate = (value: string | number | boolean | null | undefined, rowNumber: number) => {
      if (xIsNumeric) {
        const number = numericValue(value, xColumn.kind);
        return number === null ? null : margin.left + ((number - xMin) / (xMax - xMin)) * plotWidth;
      }
      const index = categoryIndex(String(value ?? ""), xCategories);
      if (index < 0) return null;
      const band = plotWidth / Math.max(xCategories.length, 1);
      return margin.left + (index + 0.5) * band + categoryJitter(rowNumber, band);
    };
    const yCoordinate = (value: string | number | boolean | null | undefined, rowNumber: number) => {
      if (yIsNumeric) {
        const number = numericValue(value, yColumn.kind);
        return number === null ? null : margin.top + plotHeight - ((number - yMin) / (yMax - yMin)) * plotHeight;
      }
      const index = categoryIndex(String(value ?? ""), yCategories);
      if (index < 0) return null;
      const band = plotHeight / Math.max(yCategories.length, 1);
      return margin.top + plotHeight - (index + 0.5) * band + categoryJitter(rowNumber, band);
    };

    for (let tick = 0; tick <= 4; tick++) {
      const y = margin.top + plotHeight - tick * plotHeight / 4;
      context.beginPath(); context.moveTo(margin.left, y); context.lineTo(width - margin.right, y); context.stroke();
      if (yIsNumeric) {
        const value = yMin + (yMax - yMin) * tick / 4;
        context.fillText(yColumn.kind === "date" ? new Date(value).toLocaleDateString() : displayValue(value), 8, y + 4);
      }
    }
    if (xIsNumeric) {
      for (let tick = 0; tick <= 4; tick++) {
        const x = margin.left + tick * plotWidth / 4;
        context.beginPath(); context.moveTo(x, margin.top); context.lineTo(x, margin.top + plotHeight); context.stroke();
        const value = xMin + (xMax - xMin) * tick / 4;
        context.fillText(xColumn.kind === "date" ? new Date(value).toLocaleDateString() : displayValue(value), x - 20, height - 36);
      }
    } else {
      const step = Math.max(1, Math.ceil(xCategories.length / 8));
      xCategories.forEach((category, index) => {
        if (index % step) return;
        const x = margin.left + (index + 0.5) * plotWidth / Math.max(xCategories.length, 1);
        context.save(); context.translate(x, height - 34); context.rotate(-0.2);
        context.fillText(shortLabel(category), -26, 0); context.restore();
      });
    }
    if (!yIsNumeric) {
      const step = Math.max(1, Math.ceil(yCategories.length / 8));
      yCategories.forEach((category, index) => {
        if (index % step) return;
        const y = margin.top + plotHeight - (index + 0.5) * plotHeight / Math.max(yCategories.length, 1);
        context.fillText(shortLabel(category), 8, y + 4);
      });
    }
    context.fillStyle = "#667085";
    context.textAlign = "center";
    context.fillText(xField, margin.left + plotWidth / 2, height - 8);
    context.save(); context.translate(18, margin.top + plotHeight / 2); context.rotate(-Math.PI / 2); context.fillText(yField, 0, 0); context.restore();
    context.textAlign = "start";

    const points: Point[] = [];
    context.fillStyle = "rgba(91, 77, 214, 0.7)";
    for (const row of rows) {
      const x = xCoordinate(row.values[xField], row.row_number);
      const y = yCoordinate(row.values[yField], row.row_number);
      if (x === null || y === null) continue;
      context.beginPath(); context.arc(x, y, 3.5, 0, Math.PI * 2); context.fill();
      points.push({ x, y, row });
    }
    pointsRef.current = points;
    setSize({ width, height });
  }, [rows, xColumn, yColumn, xField, yField]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [draw]);

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    let nearest: Point | null = null;
    let nearestDistance = 12 * 12;
    for (const point of pointsRef.current) {
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < nearestDistance) { nearest = point; nearestDistance = distance; }
    }
    setHovered(nearest ? { point: nearest, left: Math.min(x + 14, bounds.width - 240), top: Math.max(8, y - 16) } : null);
  };

  if (!xColumn || !yColumn || xField === yField) {
    return <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">Choose two different fields to plot their relationship.</div>;
  }
  const pointCount = countPlotRows(rows, columns, xField, yField);
  return <div className="relative overflow-hidden rounded-lg border border-border bg-card p-2 sm:p-3">
    {pointCount === 0
      ? <div className="flex min-h-64 items-center justify-center p-8 text-center text-sm text-muted-foreground">No rows on this page have values for both selected fields. Try another pair.</div>
      : <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${pointCount} Excel rows plotted with ${xField} on the horizontal axis and ${yField} on the vertical axis. Hover over a point to see its row values.`}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHovered(null)}
          className="block h-[380px] w-full touch-pan-y"
        />}
    {hovered && <div className="pointer-events-none absolute z-10 max-h-64 max-w-64 overflow-auto whitespace-pre-line rounded-md border border-border bg-popover p-3 text-xs shadow-lg" style={{ left: Math.max(8, Math.min(hovered.left, size.width - 272)), top: hovered.top }}>
      <p className="mb-1 font-semibold text-foreground">Excel row {hovered.point.row.row_number}</p>
      <p className="text-muted-foreground">{buildTooltip(hovered.point.row)}</p>
    </div>}
  </div>;
}
