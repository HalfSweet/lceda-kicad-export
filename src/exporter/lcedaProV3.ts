function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown, fallback = 0): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	const n = Number.parseFloat(String(value ?? ''));
	return Number.isFinite(n) ? n : fallback;
}

function toInteger(value: unknown, fallback = 0): number {
	return Math.round(toNumber(value, fallback));
}

function toStringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function toBoolean(value: unknown, fallback = false): boolean {
	if (typeof value === 'boolean') {
		return value;
	}
	if (value === null || value === undefined) {
		return fallback;
	}
	const s = String(value).trim().toLowerCase();
	if (s === 'true' || s === '1')
		return true;
	if (s === 'false' || s === '0')
		return false;
	return fallback;
}

function normalizeStrokeColor(value: unknown): string {
	const raw = value === null || value === undefined ? undefined : String(value).trim();
	if (!raw) {
		return '#000000';
	}
	return raw;
}

function normalizeFillColor(value: unknown): string {
	const raw = value === null || value === undefined ? undefined : String(value).trim();
	if (!raw) {
		return 'none';
	}
	return raw;
}

function sanitizeShapeField(value: string): string {
	return value
		.replaceAll('^^', '_')
		.replaceAll('~', '_')
		.replaceAll(/\r?\n/g, ' ')
		.trim();
}

function formatPoints(points: unknown): string | undefined {
	if (!points) {
		return undefined;
	}

	if (Array.isArray(points)) {
		const values: number[] = [];
		for (const item of points) {
			if (typeof item === 'number' && Number.isFinite(item)) {
				values.push(item);
				continue;
			}
			if (isRecord(item)) {
				if (typeof item.x === 'number' && typeof item.y === 'number') {
					values.push(item.x, item.y);
				}
				else if (typeof item.centerX === 'number' && typeof item.centerY === 'number') {
					values.push(item.centerX, item.centerY);
				}
			}
		}
		return values.length >= 4 ? values.join(' ') : undefined;
	}

	return undefined;
}

function extractJsonObjectStrings(value: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < value.length; i++) {
		const ch = value[i];

		if (inString) {
			if (escaped) {
				escaped = false;
			}
			else if (ch === '\\') {
				escaped = true;
			}
			else if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === '{') {
			if (depth === 0) {
				start = i;
			}
			depth++;
			continue;
		}
		if (ch === '}') {
			if (depth > 0) {
				depth--;
				if (depth === 0 && start >= 0) {
					out.push(value.slice(start, i + 1));
					start = -1;
				}
			}
		}
	}

	return out;
}

function safeJsonParseObject(value: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(value);
		return isRecord(parsed) ? parsed : undefined;
	}
	catch {
		return undefined;
	}
}

interface LcedaV3Outer {
	type: string;
	id?: string;
	ticket?: number;
}

interface LcedaV3Record {
	outer: LcedaV3Outer;
	inner: Record<string, unknown>;
}

function parseRecordsLineBased(source: string): LcedaV3Record[] | undefined {
	const lines = source
		.split(/\r?\n/u)
		.map(line => line.trim())
		.filter(Boolean);
	if (lines.length < 2) {
		return undefined;
	}

	const records: LcedaV3Record[] = [];
	for (const line of lines) {
		const idx = line.indexOf('||');
		if (idx < 0) {
			return undefined;
		}
		const outerText = line.slice(0, idx).trim();
		const innerText = line.slice(idx + 2).trim();
		const outer = safeJsonParseObject(outerText);
		const inner = safeJsonParseObject(innerText);
		if (!outer || !inner) {
			return undefined;
		}
		const type = toStringValue(outer.type);
		if (!type) {
			return undefined;
		}
		records.push({
			outer: {
				type,
				id: toStringValue(outer.id),
				ticket: typeof outer.ticket === 'number' ? outer.ticket : undefined,
			},
			inner,
		});
	}

	return records.length > 0 ? records : undefined;
}

function parseRecordsFromObjectPairs(source: string): LcedaV3Record[] | undefined {
	const objects = extractJsonObjectStrings(source);
	if (objects.length < 4 || objects.length % 2 !== 0) {
		return undefined;
	}

	const parsed: Record<string, unknown>[] = [];
	for (const text of objects) {
		const obj = safeJsonParseObject(text);
		if (!obj) {
			return undefined;
		}
		parsed.push(obj);
	}

	const records: LcedaV3Record[] = [];
	for (let i = 0; i < parsed.length - 1; i += 2) {
		const outerRaw = parsed[i];
		const inner = parsed[i + 1];
		const type = toStringValue(outerRaw.type);
		if (!type || !inner) {
			return undefined;
		}
		records.push({
			outer: {
				type,
				id: toStringValue(outerRaw.id),
				ticket: typeof outerRaw.ticket === 'number' ? outerRaw.ticket : undefined,
			},
			inner,
		});
	}

	return records.length > 0 ? records : undefined;
}

function parseLcedaProV3Records(source: string): LcedaV3Record[] | undefined {
	const byLines = parseRecordsLineBased(source);
	if (byLines) {
		return byLines;
	}
	return parseRecordsFromObjectPairs(source);
}

function getDocType(records: LcedaV3Record[]): string | undefined {
	const head = records.find(r => r.outer.type === 'DOCHEAD');
	return head ? toStringValue(head.inner.docType) : undefined;
}

function getCanvasOrigin(records: LcedaV3Record[]): { originX: number; originY: number } {
	const canvas = records.find(r => r.outer.type === 'CANVAS');
	return {
		originX: toNumber(canvas?.inner.originX, 0),
		originY: toNumber(canvas?.inner.originY, 0),
	};
}

function buildSymbolShapes(records: LcedaV3Record[]): string[] {
	const attrByParent = new Map<string, Map<string, string>>();
	for (const r of records) {
		if (r.outer.type !== 'ATTR') {
			continue;
		}
		const parentId = toStringValue(r.inner.parentId) ?? '';
		if (!parentId) {
			continue;
		}
		const key = (toStringValue(r.inner.key) ?? '').toUpperCase();
		const value = toStringValue(r.inner.value) ?? '';
		if (!key) {
			continue;
		}
		let dict = attrByParent.get(parentId);
		if (!dict) {
			dict = new Map();
			attrByParent.set(parentId, dict);
		}
		dict.set(key, value);
	}

	const shapes: string[] = [];
	for (const r of records) {
		const { outer, inner } = r;

		if (outer.type === 'PIN') {
			if (!toBoolean(inner.display, true)) {
				continue;
			}
			const id = outer.id ?? '';
			const attrs = id ? attrByParent.get(id) : undefined;
			const pinName = sanitizeShapeField(attrs?.get('NAME') ?? '');
			const pinNumber = sanitizeShapeField(attrs?.get('NUMBER') ?? '');

			const x = toNumber(inner.x, 0);
			const y = toNumber(inner.y, 0);
			const rotation = toInteger(inner.rotation, 0);
			const length = toNumber(inner.length, 100);
			const locked = toBoolean(inner.locked, false);
			const pinShape = (toStringValue(inner.pinShape) ?? 'NONE').toUpperCase();

			const electricalType = '0';
			const show = '1';

			const hasDot = pinShape.includes('INVERTED');
			const hasClock = pinShape.includes('CLOCK');
			const dotFlag = hasDot ? '1' : '0';
			const clockFlag = hasClock ? '1' : '0';

			const isVertical = rotation === 90 || rotation === 270;
			const path = isVertical ? `M 0 0 v ${length}` : `M 0 0 h ${length}`;

			const settings = `P~${show}~${electricalType}~${pinNumber || String(shapes.length + 1)}~${x}~${y}~${rotation}~${id}~${locked ? 1 : 0}`;
			const nameData = `1~0~0~0~${pinName || (pinNumber || '')}~7`;
			const numData = `1~0~0~0~${pinNumber || ''}~7`;
			const invertedData = `${dotFlag}~0~0`;
			const clockData = `${clockFlag}~`;

			shapes.push([settings, '', path, nameData, numData, invertedData, clockData].join('^^'));
			continue;
		}

		if (outer.type === 'RECT') {
			const x1 = toNumber(inner.dotX1, toNumber(inner.x, 0));
			const y1 = toNumber(inner.dotY1, toNumber(inner.y, 0));
			const x2 = toNumber(inner.dotX2, x1);
			const y2 = toNumber(inner.dotY2, y1);
			const x = Math.min(x1, x2);
			const y = Math.min(y1, y2);
			const width = Math.abs(x2 - x1);
			const height = Math.abs(y2 - y1);
			const rx = toNumber(inner.radiusX, 0);
			const ry = toNumber(inner.radiusY, 0);
			const strokeColor = normalizeStrokeColor(inner.strokeColor);
			const strokeWidth = toNumber(inner.strokeWidth, 1);
			const fillColor = normalizeFillColor(inner.fillColor);
			shapes.push(`R~${x}~${y}~${rx}~${ry}~${width}~${height}~${strokeColor}~${strokeWidth}~~${fillColor}~${outer.id ?? ''}~${toBoolean(inner.locked, false) ? 1 : 0}`);
			continue;
		}

		if (outer.type === 'CIRCLE') {
			const cx = toNumber(inner.centerX, 0);
			const cy = toNumber(inner.centerY, 0);
			const radius = toNumber(inner.radius, 0);
			const strokeColor = normalizeStrokeColor(inner.strokeColor);
			const strokeWidth = toNumber(inner.strokeWidth, 1);
			const fillColor = normalizeFillColor(inner.fillColor);
			shapes.push(`C~${cx}~${cy}~${radius}~${strokeColor}~${strokeWidth}~~${fillColor}~${outer.id ?? ''}~${toBoolean(inner.locked, false) ? 1 : 0}`);
			continue;
		}

		if (outer.type === 'ELLIPSE') {
			const cx = toNumber(inner.centerX, 0);
			const cy = toNumber(inner.centerY, 0);
			const rx = toNumber(inner.radiusX, 0);
			const ry = toNumber(inner.radiusY, 0);
			const strokeColor = normalizeStrokeColor(inner.strokeColor);
			const strokeWidth = toNumber(inner.strokeWidth, 1);
			const fillColor = normalizeFillColor(inner.fillColor);
			shapes.push(`E~${cx}~${cy}~${rx}~${ry}~${strokeColor}~${strokeWidth}~~${fillColor}~${outer.id ?? ''}~${toBoolean(inner.locked, false) ? 1 : 0}`);
			continue;
		}

		if (outer.type === 'LINE') {
			const x1 = toNumber(inner.startX, 0);
			const y1 = toNumber(inner.startY, 0);
			const x2 = toNumber(inner.endX, 0);
			const y2 = toNumber(inner.endY, 0);
			const points = `${x1} ${y1} ${x2} ${y2}`;
			const strokeColor = normalizeStrokeColor(inner.strokeColor);
			const strokeWidth = toNumber(inner.strokeWidth, 1);
			const fillColor = normalizeFillColor(inner.fillColor);
			shapes.push(`PL~${points}~${strokeColor}~${strokeWidth}~~${fillColor}~${outer.id ?? ''}~${toBoolean(inner.locked, false) ? 1 : 0}`);
			continue;
		}

		if (outer.type === 'POLY') {
			const points = formatPoints(inner.points);
			if (!points) {
				continue;
			}
			const strokeColor = normalizeStrokeColor(inner.strokeColor);
			const strokeWidth = toNumber(inner.strokeWidth, 1);
			const fillColor = normalizeFillColor(inner.fillColor);
			shapes.push(`PG~${points}~${strokeColor}~${strokeWidth}~~${fillColor}~${outer.id ?? ''}~${toBoolean(inner.locked, false) ? 1 : 0}`);
			continue;
		}

		if (outer.type === 'TEXT') {
			const text = sanitizeShapeField(toStringValue(inner.text) ?? toStringValue(inner.title) ?? '');
			if (!text) {
				continue;
			}
			const x = toNumber(inner.x, 0);
			const y = toNumber(inner.y, 0);
			const rotation = toNumber(inner.rotation, 0);
			const color = normalizeStrokeColor(inner.color);
			const fontSize = toNumber(inner.fontSize, 7);
			const alignEnum = (toStringValue(inner.align) ?? toStringValue(inner.hAlign) ?? '').toUpperCase();
			const align = alignEnum.startsWith('RIGHT') ? 'R' : alignEnum.startsWith('CENTER') ? 'C' : 'L';
			const textType = sanitizeShapeField(toStringValue(inner.textType) ?? 'comment');
			const id = outer.id ?? '';
			const locked = toBoolean(inner.locked, false) ? '1' : '0';

			const fields = [
				'T',
				align,
				String(x),
				String(y),
				String(rotation),
				color,
				'',
				String(fontSize),
				'',
				'',
				'',
				textType,
				text,
				'1',
				'start',
				id,
				locked,
			];
			shapes.push(fields.join('~'));
			continue;
		}
	}

	return shapes;
}

function buildFootprintShapes(records: LcedaV3Record[]): string[] {
	const shapes: string[] = [];

	for (const r of records) {
		const { outer, inner } = r;

		if (outer.type === 'PAD') {
			const num = sanitizeShapeField(toStringValue(inner.num) ?? '');
			const centerX = toNumber(inner.centerX, 0);
			const centerY = toNumber(inner.centerY, 0);
			const layerId = toInteger(inner.layerId, 1);
			const netName = sanitizeShapeField(toStringValue(inner.netName) ?? '');
			const rotation = toNumber(inner.padAngle, 0);
			const id = outer.id ?? '';
			const locked = toBoolean(inner.locked, false);

			const padDef = isRecord(inner.defaultPad) ? inner.defaultPad : undefined;
			const padTypeRaw = (toStringValue(padDef?.padType) ?? 'RECT').toUpperCase();

			let shape = padTypeRaw;
			let width = toNumber(padDef?.width, toNumber(inner.width, 0));
			let height = toNumber(padDef?.height, toNumber(inner.height, 0));
			let points = '';

			if (shape === 'POLYGON') {
				const path = Array.isArray(padDef?.path) ? padDef?.path : undefined;
				const extracted: number[] = [];
				if (path) {
					for (let i = 0; i < path.length - 1; i++) {
						const a = path[i];
						const b = path[i + 1];
						if (typeof a === 'number' && typeof b === 'number') {
							extracted.push(a, b);
							i++;
							continue;
						}
					}
				}
				if (extracted.length >= 6) {
					points = extracted.join(' ');
					const xs = extracted.filter((_, idx) => idx % 2 === 0);
					const ys = extracted.filter((_, idx) => idx % 2 === 1);
					const minX = Math.min(...xs);
					const maxX = Math.max(...xs);
					const minY = Math.min(...ys);
					const maxY = Math.max(...ys);
					width = Math.max(width, maxX - minX);
					height = Math.max(height, maxY - minY);
				}
				else {
					// Fallback to simple rect if polygon points unavailable
					shape = 'RECT';
				}
			}

			if (shape === 'ELLIPSE' && width > 0 && height > 0 && Math.abs(width - height) > 1e-6) {
				shape = 'OVAL';
			}
			if (!['ELLIPSE', 'RECT', 'OVAL', 'POLYGON'].includes(shape)) {
				shape = 'RECT';
			}

			const hole = isRecord(inner.hole) ? inner.hole : undefined;
			const holeW = toNumber(hole?.width, 0);
			const holeH = toNumber(hole?.height, 0);
			let holeRadius = 0;
			let holeLength = 0;
			if (holeW > 0 && holeH > 0) {
				holeRadius = Math.min(holeW, holeH) / 2;
				if (Math.abs(holeW - holeH) > 1e-6) {
					holeLength = Math.max(holeW, holeH);
				}
			}

			const plated = toBoolean(inner.plated, holeRadius > 0);

			shapes.push(
				[
					'PAD',
					shape,
					centerX,
					centerY,
					width,
					height,
					layerId,
					netName,
					num || id,
					holeRadius,
					points,
					rotation,
					id,
					holeLength,
					'',
					plated ? 1 : 0,
					locked ? 1 : 0,
				].join('~'),
			);
			continue;
		}

		if (outer.type === 'LINE') {
			const strokeWidth = toNumber(inner.width, toNumber(inner.strokeWidth, 0.1));
			const layerId = toInteger(inner.layerId, 21);
			const netName = sanitizeShapeField(toStringValue(inner.netName) ?? '');
			const x1 = toNumber(inner.startX, 0);
			const y1 = toNumber(inner.startY, 0);
			const x2 = toNumber(inner.endX, 0);
			const y2 = toNumber(inner.endY, 0);
			const points = `${x1} ${y1} ${x2} ${y2}`;
			const id = outer.id ?? '';
			const locked = toBoolean(inner.locked, false);
			shapes.push(['TRACK', strokeWidth, layerId, netName, points, id, locked ? 1 : 0].join('~'));
			continue;
		}

		if (outer.type === 'VIA') {
			const centerX = toNumber(inner.centerX, 0);
			const centerY = toNumber(inner.centerY, 0);
			const netName = sanitizeShapeField(toStringValue(inner.netName) ?? '');
			const viaDiameter = toNumber(inner.viaDiameter, toNumber(inner.diameter, 0));
			const holeDiameter = toNumber(inner.holeDiameter, 0);
			const radius = holeDiameter > 0 ? holeDiameter / 2 : viaDiameter > 0 ? viaDiameter / 4 : 0;
			const id = outer.id ?? '';
			const locked = toBoolean(inner.locked, false);
			shapes.push(['VIA', centerX, centerY, viaDiameter, netName, radius, id, locked ? 1 : 0].join('~'));
			continue;
		}
	}

	return shapes;
}

export function tryExtractHeadAndShapeFromLcedaProV3Source(source: string): { head: any; shape: string[] } | undefined {
	const records = parseLcedaProV3Records(source);
	if (!records) {
		return undefined;
	}

	const docType = getDocType(records);
	if (!docType) {
		return undefined;
	}

	const { originX, originY } = getCanvasOrigin(records);
	const head: Record<string, unknown> = {
		docType,
		originX,
		originY,
		x: originX,
		y: originY,
	};

	if (docType === 'SYMBOL' || docType === 'SCH_PAGE' || docType === 'SIMULATION') {
		const shape = buildSymbolShapes(records);
		return { head, shape };
	}
	if (docType === 'FOOTPRINT' || docType === 'PCB') {
		const shape = buildFootprintShapes(records);
		return { head, shape };
	}

	return undefined;
}
